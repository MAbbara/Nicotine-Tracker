const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');
const tailwindBin = path.join(projectRoot, 'node_modules', '.bin', 'tailwindcss');
const tailwindSource = path.join(projectRoot, 'static', 'css', 'tailwind.css');
const committedStylesheet = path.join(projectRoot, 'static', 'css', 'style.css');

function cleanGitEnv(overrides = {}) {
  const environment = { ...process.env, ...overrides };
  for (const name of Object.keys(environment)) {
    if (name.startsWith('GIT_')) delete environment[name];
  }
  return environment;
}

function hasPhysicalGitMetadata(start) {
  let current = fs.realpathSync(start);
  for (;;) {
    try {
      fs.lstatSync(path.join(current, '.git'));
      return true;
    } catch (error) {
      if (error.code !== 'ENOENT') return true;
    }
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

function archiveTempBase() {
  for (const candidate of [os.tmpdir(), '/dev/shm']) {
    try {
      if (!fs.statSync(candidate).isDirectory()) continue;
      fs.accessSync(candidate, fs.constants.W_OK);
      if (!hasPhysicalGitMetadata(candidate)) return fs.realpathSync(candidate);
    } catch {
      // Try the next platform temp filesystem.
    }
  }
  throw new Error('no writable temp filesystem without enclosing Git metadata');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    ...options,
  });
  assert.equal(
    result.status,
    0,
    `${command} exited ${result.status}: ${result.stderr || result.error}`,
  );
  return result;
}

function runBuffer(command, args, options = {}) {
  const result = spawnSync(command, args, options);
  assert.equal(
    result.status,
    0,
    `${command} exited ${result.status}: ${result.stderr || result.error}`,
  );
  return result;
}

function materializeHeadTree(destination) {
  const listed = run(
    'git',
    ['--no-replace-objects', 'ls-tree', '-rz', '-r', '--full-tree', 'HEAD'],
    { cwd: projectRoot, env: cleanGitEnv() },
  );
  for (const record of listed.stdout.split('\0').filter(Boolean)) {
    const [metadata, relative] = record.split('\t');
    const [mode, kind, object] = metadata.split(' ');
    assert.equal(kind, 'blob', `unsupported tracked entry ${relative}`);
    const target = path.join(destination, relative);
    const content = runBuffer(
      'git', ['--no-replace-objects', 'cat-file', 'blob', object], {
        cwd: projectRoot,
        env: cleanGitEnv(),
      },
    ).stdout;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (mode === '120000') {
      fs.symlinkSync(content.toString(), target);
    } else {
      assert.match(mode, /^100(644|755)$/);
      fs.writeFileSync(target, content, { mode: mode === '100755' ? 0o755 : 0o644 });
    }
  }
}

function createIsolatedRepository(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  materializeHeadTree(root);
  run('git', ['init', '-q'], { cwd: root });
  run('git', ['config', 'user.name', 'CSS Hermeticity Test'], { cwd: root });
  run('git', ['config', 'user.email', 'css-test@example.invalid'], { cwd: root });
  run('git', ['add', '--force', '.'], { cwd: root });
  run('git', ['commit', '-qm', 'tracked release tree'], { cwd: root });
  run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: root });
  return root;
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

test('committed production CSS is byte-identical to a tracked-only build', { timeout: 60000 }, () => {
  const cleanRoot = fs.mkdtempSync(path.join(archiveTempBase(), 'nt-css-tracked-'));
  const checkout = path.join(cleanRoot, 'checkout');
  try {
    fs.mkdirSync(checkout);
    materializeHeadTree(checkout);
    run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], {
      cwd: checkout,
    });
    fs.rmSync(path.join(checkout, '.git'), { recursive: true, force: true });
    fs.rmSync(path.join(checkout, 'static', 'css', 'style.css'));
    run('npm', ['run', 'build:css'], {
      cwd: checkout,
      env: { ...process.env, NT_CSS_BUILD_ARCHIVE: '1' },
    });
    const committed = runBuffer(
      'git', ['--no-replace-objects', 'show', 'HEAD:static/css/style.css'], {
        cwd: projectRoot,
        env: cleanGitEnv(),
      },
    ).stdout;
    const generated = fs.readFileSync(
      path.join(checkout, 'static', 'css', 'style.css'),
    );
    assert.equal(
      committed.equals(generated),
      true,
      `static/css/style.css is stale: committed ${sha256(committed)} (${committed.length} bytes), tracked-only build ${sha256(generated)} (${generated.length} bytes)`,
    );
  } finally {
    fs.rmSync(cleanRoot, { recursive: true, force: true });
  }
});

test('archive mode cannot be enabled inside a physical checkout by poisoning Git discovery', { timeout: 60000 }, () => {
  const checkout = createIsolatedRepository('nt-css-physical-git-');
  try {
    fs.writeFileSync(
      path.join(checkout, 'templates', 'untracked-archive-sentinel.html'),
      '<div class="bg-[#135790]"></div>\n',
    );
    fs.rmSync(path.join(checkout, 'static', 'css', 'style.css'));
    const result = spawnSync('npm', ['run', 'build:css'], {
      cwd: checkout,
      encoding: 'utf8',
      env: {
        ...process.env,
        NT_CSS_BUILD_ARCHIVE: '1',
        GIT_DIR: path.join(checkout, 'does-not-exist'),
        GIT_WORK_TREE: checkout,
      },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /E_CSS_ARCHIVE_GIT/);
    assert.equal(fs.existsSync(path.join(checkout, 'static', 'css', 'style.css')), false);
  } finally {
    fs.rmSync(checkout, { recursive: true, force: true });
  }
});

test('replacement refs cannot substitute another tree for physical HEAD', { timeout: 60000 }, () => {
  const checkout = createIsolatedRepository('nt-css-replacement-ref-');
  try {
    const physicalHead = run(
      'git', ['--no-replace-objects', 'rev-parse', 'HEAD'], { cwd: checkout },
    ).stdout.trim();
    fs.appendFileSync(
      path.join(checkout, 'templates', 'base.html'),
      '\n<div class="text-[#246801]"></div>\n',
    );
    run(
      path.join(checkout, 'node_modules', '.bin', 'tailwindcss'),
      ['-i', './static/css/tailwind.css', '-o', './static/css/style.css', '--minify'],
      { cwd: checkout },
    );
    run('git', ['add', '--force', 'templates/base.html', 'static/css/style.css'], {
      cwd: checkout,
    });
    run('git', ['commit', '-qm', 'replacement source tree'], { cwd: checkout });
    const replacement = run('git', ['rev-parse', 'HEAD'], { cwd: checkout }).stdout.trim();
    run('git', ['reset', '--hard', physicalHead], { cwd: checkout });
    run('git', ['replace', physicalHead, replacement], { cwd: checkout });
    fs.rmSync(path.join(checkout, 'static', 'css', 'style.css'));

    const result = spawnSync('npm', ['run', 'build:css'], {
      cwd: checkout,
      encoding: 'utf8',
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /E_CSS_REPLACE_REFS/);
    assert.equal(fs.existsSync(path.join(checkout, 'static', 'css', 'style.css')), false);
  } finally {
    fs.rmSync(checkout, { recursive: true, force: true });
  }
});

test('production CSS build refuses an untracked source under an allowed root', { timeout: 60000 }, () => {
  const checkout = createIsolatedRepository('nt-css-untracked-source-');
  try {
    fs.writeFileSync(
      path.join(checkout, 'templates', 'untracked-sentinel.html'),
      '<div class="bg-[#123456]"></div>\n',
    );
    const result = spawnSync('npm', ['run', 'build:css'], {
      cwd: checkout,
      encoding: 'utf8',
    });
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(result.signal, null);
    assert.notEqual(result.status, 0, 'untracked production source was accepted');
    assert.match(result.stderr, /E_CSS_SOURCE_UNTRACKED/);
  } finally {
    fs.rmSync(checkout, { recursive: true, force: true });
  }
});

test('production CSS build refuses dirty tracked sources even when CSS is rebuilt to match', { timeout: 60000 }, () => {
  const checkout = createIsolatedRepository('nt-css-dirty-source-');
  try {
    fs.appendFileSync(
      path.join(checkout, 'templates', 'base.html'),
      '\n<div class="text-[#abcdef]"></div>\n',
    );
    run(
      path.join(checkout, 'node_modules', '.bin', 'tailwindcss'),
      [
        '-i', './static/css/tailwind.css',
        '-o', './static/css/style.css',
        '--minify',
      ],
      { cwd: checkout },
    );
    const result = spawnSync('npm', ['run', 'build:css'], {
      cwd: checkout,
      encoding: 'utf8',
    });
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(result.signal, null);
    assert.notEqual(result.status, 0, 'dirty tracked production sources self-masked');
    assert.match(result.stderr, /E_CSS_SOURCE_DIRTY/);
  } finally {
    fs.rmSync(checkout, { recursive: true, force: true });
  }
});

test('production CSS build refuses an unstaged tracked source mode change', { timeout: 60000 }, () => {
  const checkout = createIsolatedRepository('nt-css-dirty-mode-');
  try {
    const source = path.join(checkout, 'templates', 'base.html');
    fs.chmodSync(source, 0o755);

    const result = spawnSync('npm', ['run', 'build:css'], {
      cwd: checkout,
      encoding: 'utf8',
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /E_CSS_SOURCE_MODE/);
  } finally {
    fs.rmSync(checkout, { recursive: true, force: true });
  }
});

test('production CSS build never follows a replaced output directory to an external victim', { timeout: 60000 }, () => {
  const checkout = createIsolatedRepository('nt-css-output-parent-');
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-css-external-victim-'));
  const victim = path.join(external, 'style.css');
  const victimContent = Buffer.from('external victim must remain unchanged\n');
  try {
    fs.copyFileSync(
      path.join(checkout, 'static', 'css', 'tailwind.css'),
      path.join(external, 'tailwind.css'),
    );
    fs.writeFileSync(victim, victimContent);
    fs.rmSync(path.join(checkout, 'static', 'css'), { recursive: true });
    fs.symlinkSync(external, path.join(checkout, 'static', 'css'), 'dir');

    const result = spawnSync('npm', ['run', 'build:css'], {
      cwd: checkout,
      encoding: 'utf8',
    });

    assert.equal(
      fs.readFileSync(victim).equals(victimContent),
      true,
      'external victim was overwritten through the output-parent symlink',
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /E_CSS_PATH_UNSAFE/);
    assert.deepEqual(
      fs.readdirSync(external).filter((name) => name.startsWith('.style.css.')),
      [],
    );
  } finally {
    fs.rmSync(checkout, { recursive: true, force: true });
    fs.rmSync(external, { recursive: true, force: true });
  }
});

test('production CSS build refuses staged tracked source bytes', { timeout: 60000 }, () => {
  const checkout = createIsolatedRepository('nt-css-staged-source-');
  try {
    fs.appendFileSync(
      path.join(checkout, 'templates', 'base.html'),
      '\n<div class="outline-[#ab12cd]"></div>\n',
    );
    run('git', ['add', 'templates/base.html'], { cwd: checkout });
    const result = spawnSync('npm', ['run', 'build:css'], {
      cwd: checkout,
      encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /E_CSS_SOURCE_DIRTY/);
  } finally {
    fs.rmSync(checkout, { recursive: true, force: true });
  }
});

test('production CSS build refuses a deleted tracked source', { timeout: 60000 }, () => {
  const checkout = createIsolatedRepository('nt-css-deleted-source-');
  try {
    fs.rmSync(path.join(checkout, 'templates', 'base.html'));
    const result = spawnSync('npm', ['run', 'build:css'], {
      cwd: checkout,
      encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /E_CSS_SOURCE_DIRTY/);
  } finally {
    fs.rmSync(checkout, { recursive: true, force: true });
  }
});

test('archive mode is explicit and cannot bypass a Git checkout', { timeout: 60000 }, () => {
  const checkout = createIsolatedRepository('nt-css-archive-mode-');
  try {
    fs.rmSync(path.join(checkout, 'static', 'css', 'style.css'));
    const result = spawnSync('npm', ['run', 'build:css'], {
      cwd: checkout,
      encoding: 'utf8',
      env: { ...process.env, NT_CSS_BUILD_ARCHIVE: '1' },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /E_CSS_ARCHIVE_GIT/);
  } finally {
    fs.rmSync(checkout, { recursive: true, force: true });
  }
});

test('untracked files outside production sources cannot add Tailwind utilities', { timeout: 60000 }, () => {
  const sentinel = path.join(
    projectRoot,
    `.tailwind-hermeticity-sentinel-${process.pid}.html`,
  );
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-css-sentinel-'));
  const outFile = path.join(outDir, 'style.css');
  try {
    fs.writeFileSync(sentinel, '<div class="bg-[#123456] sm:hover:text-[#abcdef]"></div>\n');
    run(tailwindBin, ['-i', tailwindSource, '-o', outFile, '--minify'], {
      cwd: projectRoot,
    });
    const committed = fs.readFileSync(committedStylesheet);
    const generated = fs.readFileSync(outFile);
    assert.equal(generated.equals(committed), true);
    assert.equal(generated.includes(Buffer.from('123456')), false);
    assert.equal(generated.includes(Buffer.from('abcdef')), false);
  } finally {
    fs.rmSync(sentinel, { force: true });
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});
