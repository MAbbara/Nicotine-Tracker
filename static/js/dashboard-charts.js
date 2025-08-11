document.addEventListener('DOMContentLoaded', function () {
    const dailyIntakeChartEl = document.getElementById('dailyIntakeChart');
    const hourlyChartEl = document.getElementById('hourlyChart');
    const insightsContentEl = document.getElementById('insights-content');

    if (!dailyIntakeChartEl) {
        return;
    }

    let dailyIntakeChart;

    const formatDate = (date) => {
        const d = new Date(date);
        let month = '' + (d.getMonth() + 1);
        let day = '' + d.getDate();
        const year = d.getFullYear();

        if (month.length < 2) month = '0' + month;
        if (day.length < 2) day = '0' + day;

        return [year, month, day].join('-');
    }

    const fetchAndRenderDailyIntakeChart = (startDate, endDate) => {
        let url = `/api/daily_intake`;
        if (startDate && endDate) {
            url += `?start_date=${startDate}&end_date=${endDate}`;
        }

        fetch(url)
            .then(response => response.json())
            .then(data => {
                const dates = Object.keys(data);
                const values = Object.values(data);

                const isDark = document.documentElement.classList.contains('dark');
                const seriesColor = isDark ? '#A78BFA' : '#8B5CF6';
                const axisColor = isDark ? '#D1D5DB' : '#4B5563';
                const gridColor = isDark ? '#374151' : '#E5E7EB';
                const bgColor = isDark ? '#1F2937' : '#FFF';

                const options = {
                    chart: {
                        type: 'line',
                        height: 256,
                        toolbar: { show: false },
                        zoom: { enabled: false },
                        background: bgColor
                    },
                    series: [{ name: 'Nicotine Intake', data: values }],
                    colors: [seriesColor],
                    stroke: { curve: 'straight', width: 2 },
                    fill: {
                        type: 'gradient',
                        gradient: {
                            shade: 'dark',
                            shadeIntensity: 0.2,
                            opacityFrom: 0.2,
                            opacityTo: 0.6,
                            stops: [0, 80, 100]
                        }
                    },
                    xaxis: {
                        categories: dates.map(d => new Date(d).toLocaleDateString()),
                        labels: { style: { colors: axisColor, fontSize: '12px' } }
                    },
                    yaxis: {
                        min: 0,
                        labels: { style: { colors: axisColor, fontSize: '12px' } }
                    },
                    grid: {
                        borderColor: gridColor,
                        strokeDashArray: 4
                    },
                    theme: {
                        mode: isDark ? 'dark' : 'light'
                    }
                };

                if (dailyIntakeChart) {
                    dailyIntakeChart.updateOptions(options);
                } else {
                    dailyIntakeChart = new ApexCharts(dailyIntakeChartEl, options);
                    dailyIntakeChart.render();
                }
            })
            .catch(err => console.error('Error loading daily intake chart:', err));
    };

    const loadHourlyChart = () => {
        if (!hourlyChartEl) return;
        fetch('/dashboard/api/hourly_distribution?days=30')
            .then(res => res.json())
            .then(data => {
                if (!data.success) return;
                if (hourlyChartEl._apexcharts) hourlyChartEl._apexcharts.destroy();
                
                const isDark = document.documentElement.classList.contains('dark');
                const seriesColor = isDark ? '#4ADE80' : '#22C55E';
                const axisColor = isDark ? '#D1D5DB' : '#4B5563';
                const gridColor = isDark ? '#374151' : '#E5E7EB';
                const bgColor = isDark ? '#1F2937' : '#FFFFFF';

                const options = {
                    chart: {
                        type: 'bar',
                        height: 256,
                        toolbar: { show: false },
                        background: bgColor,
                    },
                    series: [{ name: 'Pouches', data: data.data.map(d => d.pouches) }],
                    colors: [seriesColor],
                    xaxis: {
                        categories: data.data.map(d => d.hour),
                        labels: { style: { colors: axisColor, fontSize: '12px' } }
                    },
                    yaxis: {
                        min: 0,
                        labels: { style: { colors: axisColor, fontSize: '12px' } }
                    },
                    grid: {
                        borderColor: gridColor,
                        strokeDashArray: 4
                    },
                    theme: {
                        mode: isDark ? 'dark' : 'light'
                    }
                };
                
                new ApexCharts(hourlyChartEl, options).render();
            })
            .catch(err => console.error('Error loading hourly chart:', err));
    }

    const loadInsights = () => {
        if (!insightsContentEl) return;
        fetch('/dashboard/api/insights')
            .then(response => response.json())
            .then(data => {
                if (data.success && data.insights.length > 0) {
                    insightsContentEl.innerHTML = data.insights.map(insight => `<p class="text-sm text-gray-600 dark:text-gray-400 mb-2">• ${insight}</p>`).join('');
                } else {
                    insightsContentEl.innerHTML = '<p class="text-sm text-gray-500 dark:text-gray-400">No insights available yet.</p>';
                }
            })
            .catch(err => {
                console.error('Error loading insights:', err);
                insightsContentEl.innerHTML = '<p class="text-sm text-gray-500 dark:text-gray-400">Unable to load insights.</p>';
            });
    }

    // Initial load
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - 29);
    fetchAndRenderDailyIntakeChart(formatDate(startDate), formatDate(endDate));
    loadHourlyChart();
    loadInsights();


    const customRangeContainer = document.querySelector('#daily-intake-filter-dropdown .px-3.py-2');
    if (customRangeContainer) {
        customRangeContainer.addEventListener('click', (e) => e.stopPropagation());
    }

    document.querySelectorAll('#daily-intake-filter-dropdown a[data-range]').forEach(link => {
        link.addEventListener('click', function (e) {
            e.preventDefault();
            const range = parseInt(this.getAttribute('data-range'));
            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(endDate.getDate() - (range - 1));
            fetchAndRenderDailyIntakeChart(formatDate(startDate), formatDate(endDate));
            document.getElementById('selected-range-text').textContent = this.textContent.trim();
        });
    });

    document.getElementById('apply_custom_range').addEventListener('click', function () {
        const startDate = document.getElementById('start_date_filter').value;
        const endDate = document.getElementById('end_date_filter').value;

        if (startDate && endDate) {
            fetchAndRenderDailyIntakeChart(startDate, endDate);
            document.getElementById('selected-range-text').textContent = 'Custom Range';
            const dropdownElement = this.closest('.hs-dropdown');
            if (dropdownElement && window.HSStaticMethods) {
                window.HSStaticMethods.close(dropdownElement);
            }
        }
    });

    window.addEventListener('on-hs-appearance-change', () => {
        fetchAndRenderDailyIntakeChart();
        loadHourlyChart();
    });
});
