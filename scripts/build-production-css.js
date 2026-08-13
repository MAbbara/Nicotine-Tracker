#!/usr/bin/env node
'use strict';

const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = fs.realpathSync(process.cwd());
const archiveMode = process.env.NT_CSS_BUILD_ARCHIVE === '1';
const sourceRoots = ['templates', 'static/js', 'routes', 'services', 'models'];
const exactInputs = new Set([
  'app.py',
  'static/css/tailwind.css',
  'scripts/build-production-css.js',
  'package.json',
  'package-lock.json',
]);
const outputRelative = 'static/css/style.css';
const gitPaths = [...sourceRoots, ...exactInputs, outputRelative];
const directoryFlags = fs.constants.O_RDONLY
  | fs.constants.O_DIRECTORY
  | fs.constants.O_NOFOLLOW;
const fileFlags = fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW;
let repositoryIdentity;

class BuildRefusal extends Error {
  constructor(marker) {
    super(marker);
    this.marker = marker;
  }
}

function refuse(marker) {
  throw new BuildRefusal(marker);
}

function permissionMode(metadata) {
  return metadata.mode & 0o7777;
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function components(relative) {
  if (
    typeof relative !== 'string'
    || relative === ''
    || path.posix.isAbsolute(relative)
    || path.posix.normalize(relative) !== relative
  ) {
    refuse('E_CSS_PATH_UNSAFE');
  }
  const result = relative.split('/');
  if (result.some((component) => component === '' || component === '.' || component === '..')) {
    refuse('E_CSS_PATH_UNSAFE');
  }
  return result;
}

function descriptorPath(descriptor, leaf = '') {
  const base = `/proc/self/fd/${descriptor}`;
  return leaf === '' ? base : `${base}/${leaf}`;
}

function assertDirectoryMetadata(metadata) {
  const mode = permissionMode(metadata);
  if (
    !metadata.isDirectory()
    || metadata.isSymbolicLink()
    || metadata.uid !== repositoryIdentity.uid
    || metadata.dev !== repositoryIdentity.dev
    || (mode & 0o7000) !== 0
    || (mode & 0o700) !== 0o700
    || (mode & 0o022) !== 0
  ) {
    refuse('E_CSS_PATH_UNSAFE');
  }
}

function assertFileMetadata(metadata) {
  const mode = permissionMode(metadata);
  if (
    !metadata.isFile()
    || metadata.isSymbolicLink()
    || metadata.uid !== repositoryIdentity.uid
    || metadata.dev !== repositoryIdentity.dev
    || (mode & 0o7000) !== 0
    || (mode & 0o022) !== 0
  ) {
    refuse('E_CSS_PATH_UNSAFE');
  }
}

function initializeRepositoryIdentity() {
  let before;
  let descriptor;
  try {
    before = fs.lstatSync(projectRoot);
    if (!before.isDirectory() || before.isSymbolicLink()) refuse('E_CSS_PATH_UNSAFE');
    descriptor = fs.openSync(projectRoot, directoryFlags);
    const opened = fs.fstatSync(descriptor);
    if (!sameIdentity(before, opened)) refuse('E_CSS_PATH_UNSAFE');
    repositoryIdentity = {
      dev: opened.dev,
      ino: opened.ino,
      uid: opened.uid,
    };
    if (typeof process.getuid === 'function' && opened.uid !== process.getuid()) {
      refuse('E_CSS_PATH_UNSAFE');
    }
    assertDirectoryMetadata(opened);
  } catch (error) {
    if (error instanceof BuildRefusal) throw error;
    refuse('E_CSS_PATH_UNSAFE');
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function openSecureDirectory(relative) {
  const names = relative === '' ? [] : components(relative);
  let descriptor;
  try {
    descriptor = fs.openSync(projectRoot, directoryFlags);
    let opened = fs.fstatSync(descriptor);
    if (!sameIdentity(opened, repositoryIdentity)) refuse('E_CSS_PATH_UNSAFE');
    assertDirectoryMetadata(opened);
    for (const name of names) {
      const candidate = descriptorPath(descriptor, name);
      const before = fs.lstatSync(candidate);
      assertDirectoryMetadata(before);
      const child = fs.openSync(candidate, directoryFlags);
      const after = fs.fstatSync(child);
      if (!sameIdentity(before, after)) {
        fs.closeSync(child);
        refuse('E_CSS_PATH_UNSAFE');
      }
      assertDirectoryMetadata(after);
      fs.closeSync(descriptor);
      descriptor = child;
      opened = after;
    }
    return { descriptor, metadata: opened };
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (error instanceof BuildRefusal) throw error;
    refuse('E_CSS_PATH_UNSAFE');
  }
}

function assertDirectoryStillConnected(relative, expected) {
  const current = openSecureDirectory(relative);
  try {
    if (!sameIdentity(current.metadata, expected)) refuse('E_CSS_PATH_UNSAFE');
  } finally {
    fs.closeSync(current.descriptor);
  }
}

function secureFile(relative, { allowMissing = false, read = false } = {}) {
  const names = components(relative);
  const leaf = names.pop();
  const parentRelative = names.join('/');
  const parent = openSecureDirectory(parentRelative);
  let descriptor;
  try {
    const candidate = descriptorPath(parent.descriptor, leaf);
    let before;
    try {
      before = fs.lstatSync(candidate);
    } catch (error) {
      if (allowMissing && error.code === 'ENOENT') return null;
      refuse('E_CSS_PATH_UNSAFE');
    }
    assertFileMetadata(before);
    descriptor = fs.openSync(candidate, fileFlags);
    const opened = fs.fstatSync(descriptor);
    if (!sameIdentity(before, opened)) refuse('E_CSS_PATH_UNSAFE');
    assertFileMetadata(opened);
    const content = read ? fs.readFileSync(descriptor) : undefined;
    const after = fs.fstatSync(descriptor);
    if (!sameIdentity(opened, after) || permissionMode(opened) !== permissionMode(after)) {
      refuse('E_CSS_PATH_UNSAFE');
    }
    assertDirectoryStillConnected(parentRelative, parent.metadata);
    return { content, metadata: after };
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.closeSync(parent.descriptor);
  }
}

function controlledGitEnvironment() {
  const environment = { ...process.env };
  for (const name of Object.keys(environment)) {
    if (name.startsWith('GIT_')) delete environment[name];
  }
  environment.GIT_CONFIG_NOSYSTEM = '1';
  environment.GIT_CONFIG_GLOBAL = os.devNull;
  environment.GIT_OPTIONAL_LOCKS = '0';
  return environment;
}

function runGit(args, options = {}) {
  const result = spawnSync('git', ['--no-replace-objects', '-C', projectRoot, ...args], {
    ...options,
    cwd: projectRoot,
    encoding: null,
    maxBuffer: 32 * 1024 * 1024,
    env: controlledGitEnvironment(),
  });
  if (result.status !== 0) {
    return null;
  }
  return result.stdout;
}

function physicalGitMetadata() {
  let current = projectRoot;
  for (;;) {
    const candidate = path.join(current, '.git');
    try {
      fs.lstatSync(candidate);
      return { metadata: candidate, root: current };
    } catch (error) {
      if (error.code !== 'ENOENT') refuse('E_CSS_GIT');
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function isProductionInput(relative) {
  if (exactInputs.has(relative)) return true;
  if (relative.startsWith('templates/')) return relative.endsWith('.html');
  if (relative.startsWith('static/js/')) return relative.endsWith('.js');
  return ['routes/', 'services/', 'models/'].some(
    (prefix) => relative.startsWith(prefix) && relative.endsWith('.py'),
  );
}

function collectFilesystemInputs() {
  const inputs = new Map();

  function add(relative) {
    const entry = secureFile(relative, { read: true });
    inputs.set(relative, entry);
  }

  function walk(relative) {
    let directory;
    let entries;
    try {
      directory = openSecureDirectory(relative);
      entries = fs.readdirSync(descriptorPath(directory.descriptor), {
        withFileTypes: true,
      });
    } finally {
      if (directory !== undefined) fs.closeSync(directory.descriptor);
    }
    entries.sort((left, right) => Buffer.from(left.name).compare(Buffer.from(right.name)));
    for (const entry of entries) {
      const child = path.posix.join(relative, entry.name);
      if (entry.isSymbolicLink()) refuse('E_CSS_SOURCE_UNTRACKED');
      if (entry.isDirectory()) {
        walk(child);
      } else if (entry.isFile() && isProductionInput(child)) {
        add(child);
      }
    }
  }

  for (const relative of exactInputs) add(relative);
  for (const root of sourceRoots) walk(root);
  return inputs;
}

function gitContext(metadata) {
  if (metadata === null) return null;
  const top = runGit(['rev-parse', '--show-toplevel']);
  if (top === null) return null;
  let canonical;
  try {
    canonical = fs.realpathSync(top.toString().trim());
  } catch {
    refuse('E_CSS_GIT');
  }
  if (canonical !== projectRoot) refuse('E_CSS_GIT');
  return canonical;
}

function rejectReplacementRefs() {
  const replacements = runGit([
    'for-each-ref', '--format=%(refname)', 'refs/replace/',
  ]);
  if (replacements === null) refuse('E_CSS_GIT');
  if (replacements.toString().trim() !== '') refuse('E_CSS_REPLACE_REFS');
}

function trackedHeadInputs(filesystemInputs, head) {
  const listing = runGit([
    'ls-tree', '-rz', '-r', '--full-tree', head, '--', ...gitPaths,
  ]);
  if (listing === null) refuse('E_CSS_GIT');
  const approved = new Map();
  for (const record of listing.toString().split('\0').filter(Boolean)) {
    const tab = record.indexOf('\t');
    if (tab < 0) refuse('E_CSS_GIT');
    const [mode, kind, object] = record.slice(0, tab).split(' ');
    const relative = record.slice(tab + 1);
    if (!isProductionInput(relative)) continue;
    if (kind !== 'blob' || !/^100(644|755)$/.test(mode)) {
      refuse('E_CSS_SOURCE_DIRTY');
    }
    const content = runGit(['cat-file', 'blob', object]);
    if (content === null) refuse('E_CSS_GIT');
    approved.set(relative, { content, mode: mode === '100755' ? 0o755 : 0o644 });
  }
  if ([...filesystemInputs.keys()].some((relative) => !approved.has(relative))) {
    refuse('E_CSS_SOURCE_UNTRACKED');
  }
  if ([...approved.keys()].some((relative) => !filesystemInputs.has(relative))) {
    refuse('E_CSS_SOURCE_DIRTY');
  }
  for (const [relative, entry] of approved) {
    const filesystem = filesystemInputs.get(relative);
    if (!entry.content.equals(filesystem.content)) {
      refuse('E_CSS_SOURCE_DIRTY');
    }
    if (entry.mode !== permissionMode(filesystem.metadata)) {
      refuse('E_CSS_SOURCE_MODE');
    }
  }
  const index = runGit(
    ['diff', '--cached', '--quiet', head, '--', ...gitPaths],
  );
  if (index === null) refuse('E_CSS_SOURCE_DIRTY');
  return approved;
}

function trackedHeadOutput(head) {
  const listing = runGit([
    'ls-tree', '-z', '--full-tree', head, '--', outputRelative,
  ]);
  if (listing === null) refuse('E_CSS_GIT');
  const records = listing.toString().split('\0').filter(Boolean);
  if (records.length !== 1) refuse('E_CSS_SOURCE_DIRTY');
  const tab = records[0].indexOf('\t');
  if (tab < 0 || records[0].slice(tab + 1) !== outputRelative) refuse('E_CSS_GIT');
  const [mode, kind] = records[0].slice(0, tab).split(' ');
  if (kind !== 'blob' || !/^100(644|755)$/.test(mode)) {
    refuse('E_CSS_SOURCE_DIRTY');
  }
  return mode === '100755' ? 0o755 : 0o644;
}

function archiveInputs(filesystemInputs) {
  return new Map(
    [...filesystemInputs].map(([relative, entry]) => [
      relative,
      { content: entry.content, mode: permissionMode(entry.metadata) },
    ]),
  );
}

function secureDirectory(root, relative) {
  const target = path.join(root, relative);
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  fs.chmodSync(target, 0o700);
}

function materialize(root, approved) {
  for (const [relative, entry] of approved) {
    secureDirectory(root, path.dirname(relative));
    const target = path.join(root, relative);
    fs.writeFileSync(target, entry.content, { flag: 'wx', mode: entry.mode });
    fs.chmodSync(target, entry.mode);
  }
  const dependencies = openSecureDirectory('node_modules');
  try {
    const dependencyPath = fs.realpathSync(descriptorPath(dependencies.descriptor));
    fs.symlinkSync(dependencyPath, path.join(root, 'node_modules'), 'dir');
  } finally {
    fs.closeSync(dependencies.descriptor);
  }
}

function publish(content, expectedMode) {
  const parentRelative = path.posix.dirname(outputRelative);
  const destinationLeaf = path.posix.basename(outputRelative);
  const parent = openSecureDirectory(parentRelative);
  const destination = descriptorPath(parent.descriptor, destinationLeaf);
  const temporaryLeaf = `.style.css.${process.pid}.${randomBytes(12).toString('hex')}.tmp`;
  const temporary = descriptorPath(parent.descriptor, temporaryLeaf);
  let descriptor;
  try {
    const existing = secureFile(outputRelative, { allowMissing: true });
    if (existing !== null && permissionMode(existing.metadata) !== expectedMode) {
      refuse('E_CSS_SOURCE_MODE');
    }
    descriptor = fs.openSync(
      temporary,
      fs.constants.O_WRONLY
        | fs.constants.O_CREAT
        | fs.constants.O_EXCL
        | fs.constants.O_NOFOLLOW,
      0o600,
    );
    fs.writeFileSync(descriptor, content);
    fs.fsyncSync(descriptor);
    fs.fchmodSync(descriptor, 0o644);
    fs.closeSync(descriptor);
    descriptor = undefined;
    const staged = fs.lstatSync(temporary);
    assertFileMetadata(staged);
    if (permissionMode(staged) !== 0o644) refuse('E_CSS_PATH_UNSAFE');
    assertDirectoryStillConnected(parentRelative, parent.metadata);
    const destinationCurrent = secureFile(outputRelative, { allowMissing: true });
    if (
      (existing === null) !== (destinationCurrent === null)
      || (
        existing !== null
        && !sameIdentity(existing.metadata, destinationCurrent.metadata)
      )
    ) {
      refuse('E_CSS_PATH_UNSAFE');
    }
    fs.renameSync(temporary, destination);
    fs.fsyncSync(parent.descriptor);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(temporary, { force: true });
    fs.closeSync(parent.descriptor);
  }
}

function main() {
  initializeRepositoryIdentity();
  const metadata = physicalGitMetadata();
  if (archiveMode && metadata !== null) refuse('E_CSS_ARCHIVE_GIT');
  if (!archiveMode && metadata === null) refuse('E_CSS_GIT');
  const git = gitContext(metadata);
  if (!archiveMode && git === null) refuse('E_CSS_GIT');
  let head;
  let outputMode = 0o644;
  if (!archiveMode) {
    rejectReplacementRefs();
    head = runGit(['rev-parse', '--verify', 'HEAD^{commit}']);
    if (head === null) refuse('E_CSS_GIT');
    head = head.toString().trim();
    outputMode = trackedHeadOutput(head);
  }
  const filesystemInputs = collectFilesystemInputs();
  const approved = archiveMode
    ? archiveInputs(filesystemInputs)
    : trackedHeadInputs(filesystemInputs, head);
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-css-build-'));
  fs.chmodSync(staging, 0o700);
  try {
    materialize(staging, approved);
    const binary = path.join(staging, 'node_modules/.bin/tailwindcss');
    const result = spawnSync(
      binary,
      [
        '-i', path.join(staging, 'static/css/tailwind.css'),
        '-o', path.join(staging, 'static/css/style.css'),
        '--minify',
      ],
      { cwd: staging, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
    );
    if (result.status !== 0) refuse('E_CSS_BUILD');
    publish(fs.readFileSync(path.join(staging, 'static/css/style.css')), outputMode);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof BuildRefusal ? error.marker : 'E_CSS_BUILD'}\n`);
  process.exitCode = 1;
}
