<script>
    import { screenHeightDips, screenWidthDips } from '~/variables';
    import dayjs from 'dayjs';
    import { onMount } from 'svelte';
    import { Template } from 'svelte-native/components';
    import { showModal } from 'svelte-native';
    import { showSnack } from 'nativescript-material-snackbar';
    import { formatValueToUnit, convertTime, titlecase } from '~/helpers/formatter';
    import { IMapPos } from '~/helpers/geo';
    import { showError } from '~/utils/error';
    import { action, alert, confirm, prompt } from 'nativescript-material-dialogs';
    import { clog, DEV_LOG } from '~/utils/logging';
    import { getCityName, findCitiesByName, networkService, getDarkSkyWeather } from '~/services/api';
    import { getNumber, getString, remove as removeSetting, setBoolean, setNumber, setString } from '@nativescript/core/application-settings';
    import { ObservableArray } from '@nativescript/core/data/observable-array';
    import { Page } from '@nativescript/core/ui/page';
    import { localize as l } from '~/helpers/formatter';
    import { GenericGeoLocation, GPS, LocationMonitor, Options as GeolocationOptions, setGeoLocationKeys, setMockEnabled } from 'nativescript-gps';
    import { request as requestPerm, Status as PermStatus, setDebug as setPermsDebug } from 'nativescript-perms';
    import { actionBarHeight, darkColor, primaryColor } from '~/variables';
    import { colorFromTempC, UNITS } from '~/helpers/formatter';

    import LineChart from 'nativescript-chart/charts/LineChart';
    import { LineDataSet, Mode } from 'nativescript-chart/data/LineDataSet';
    import { LineData } from 'nativescript-chart/data/LineData';
    import { LinearGradient, RadialGradient, TileMode } from 'nativescript-canvas';

    import { layout } from '@nativescript/core/utils/utils';
    // @ts-ignore
    import CActionBar from './CActionBar.svelte';
    // @ts-ignore
    import WeatherIcon from './WeatherIcon.svelte';
    import DailyView from './DailyView.svelte';
    // @ts-ignore
    // import WeatherListItem from './WeatherListItem.svelte';
    import TopWeatherView from './TopWeatherView.svelte';
    import HourlyView from './HourlyView.svelte';
    // @ts-ignore
    import SelectCity from './SelectCity.svelte';
    setGeoLocationKeys('lat', 'lon', 'altitude');

    // let gps;
    // let page;
    // let collectionView;
    let lineChart;
    let loading = false;
    let lastUpdate = getNumber('lastUpdate', -1);
    // let dayIndex = 0;
    let weatherLocation = JSON.parse(getString('weatherLocation', '{"name":"Grenoble","sys":{"osm_id":80348,"osm_type":"R","extent":[5.6776059,45.2140762,5.7531176,45.1541442],"country":"France","osm_key":"place","osm_value":"city","name":"Grenoble","state":"Auvergne-Rhône-Alpes"},"coord":{"lat":45.1875602,"lon":5.7357819}}'));
    let dsWeather = JSON.parse(getString('lastDsWeather', 'null'));
    // let currentWeather;
    // let chartInitialized = false;
    // let chartSet;
    // let scrollIndex;

    let topHeight = screenHeightDips - actionBarHeight - 22;
    if (gVars.isAndroid) {
        topHeight -= 50;
    }

    let items;

    async function refreshWeather() {
        if (!networkService.connected) {
            showSnack({ message: l('no_network') }); 
        }
        loading = true;
        try {
            dsWeather = await getDarkSkyWeather(weatherLocation.coord.lat, weatherLocation.coord.lon);
            lastUpdate = Date.now();
            items = prepareItems();
            // setDay(0);
            setNumber('lastUpdate', lastUpdate);
            setString('lastDsWeather', JSON.stringify(dsWeather));
        } catch (err) {
            showError(err);
        } finally {
            loading = false;
        }
    }

    function saveLocation(result) {
        const cityChanged = !weatherLocation || (result.coord.lat !== weatherLocation.coord.lat || weatherLocation.coord.lon !== result.coord.lat);
        if (cityChanged) {
            weatherLocation = result;
            setString('weatherLocation', JSON.stringify(weatherLocation));
            refreshWeather();
        }
    }

    function prepareItems() {
        // console.log('prepareItems', dsWeather);
        const newItems = new ObservableArray([]);
        dsWeather.daily.data.forEach((d, index) => {
            if (index === 0) {
                const now = dayjs()
                    .endOf('h')
                    .valueOf();
                let currentWeather = dsWeather.daily.data[index];
                const firstHourIndex = currentWeather.hourly.findIndex(h => h.time >= now);
                // hourlyItems = currentWeather.hourly.slice(firstHourIndex);
                // console.log('prepareItems', index, now, firstHourIndex);
                if (firstHourIndex > 0) {
                    currentWeather = Object.assign({}, currentWeather, currentWeather.hourly[firstHourIndex - 1]);
                } else {
                    currentWeather = Object.assign({}, currentWeather, dsWeather.currently);
                }
                newItems.push(
                    Object.assign(currentWeather, {
                        showHourly: false,
                        lastUpdate: lastUpdate,
                        hourly: currentWeather.hourly.slice(firstHourIndex),
                        minutely: dsWeather.minutely,
                        alerts: dsWeather.alerts
                    })
                );

                newItems.push({
                    icon: dsWeather.daily.icon,
                    summary: dsWeather.daily.summary
                });
            } else {
                const items = d.hourly;
                const sunriseTime = dayjs(d.sunriseTime)
                    .endOf('h')
                    .valueOf();
                newItems.push(
                    Object.assign(d, {
                        index:newItems.length,
                        scrollIndex: items.findIndex(h => h.time >= sunriseTime)
                    })
                );
            }
        });

        return newItems;
    }
    // function setDay(index) {
    //     const changed = index !== dayIndex;
    //     dayIndex = index;
    //     const nbDays = dsWeather.daily.data.length;
    //     currentWeather = dsWeather.daily.data[index];
    //     console.log('currentWeather', JSON.stringify(currentWeather));
    //     console.log('hourly', JSON.stringify(currentWeather.hourly));
    //     if (index === 0) {
    //         const now = dayjs()
    //             .endOf('h')
    //             .valueOf();
    //         const firstHourIndex = currentWeather.hourly.findIndex(h => h.time >= now);
    //         hourlyItems = currentWeather.hourly.slice(firstHourIndex);
    //         // console.log('setDay', index, now, firstHourIndex, hourlyItems.length);
    //         if (firstHourIndex > 0) {
    //             currentWeather = Object.assign({}, currentWeather, currentWeather.hourly[firstHourIndex - 1]);
    //         } else {
    //             currentWeather = Object.assign({}, currentWeather, dsWeather.currently);
    //         }
    //         scrollIndex = 0;
    //         // changed && setTimeout(() => collectionView.nativeView.scrollToIndex(0, false), 100);
    //     } else {
    //         const items = currentWeather.hourly;
    //         hourlyItems = items;
    //         const sunriseTime = dayjs(currentWeather.sunriseTime)
    //             .endOf('h')
    //             .valueOf();
    //         scrollIndex = items.findIndex(h => h.time >= sunriseTime);
    //         // console.log('setDay', index, sunriseTime, firstHourIndex, hourlyItems.length);

    //         // changed && setTimeout(() => collectionView.nativeView.scrollToIndex(firstHourIndex + 1, false), 100);
    //     }
    //     // nextDayData = index < nbDays - 1 ? dsWeather.daily.data[index + 1] : undefined;
    //     // prevDayData = index > 0 ? dsWeather.daily.data[index - 1] : undefined;
    //     console.log('hourlyItems', JSON.stringify(hourlyItems));
    //     updateLineChart();
    // }
    // function decrementDay() {
    //     setDay(dayIndex - 1);
    // }
    // function incrementDay() {
    //     setDay(dayIndex + 1);
    // }
    // function updateLineChart() {
    //     const chart = lineChart.nativeView;
    //     if (chart) {
    //         if (!chartInitialized) {
    //             chartInitialized = true;
    //             chart.setAutoScaleMinMaxEnabled(true);
    //             chart.getLegend().setEnabled(false);
    //             chart.getXAxis().setEnabled(false);
    //             chart.getAxisLeft().setEnabled(false);
    //             chart.getAxisRight().setEnabled(false);
    //             chart.setMinOffset(0);
    //             chart.setExtraTopOffset(10);
    //             // chart.setLogEnabled(true);
    //         }
    //         if (!chartSet) {
    //             chartSet = new LineDataSet(currentWeather.hourly, 'temperature', 'time', 'temperature');
    //             chartSet.setColor('white');
    //             chartSet.setLineWidth(3);
    //             chartSet.setDrawIcons(false);
    //             chartSet.setDrawValues(false);
    //             chartSet.setDrawFilled(true);
    //             // chartSet.setFillAlpha(255);
    //             // chartSet.setFillColor('white');
    //             chartSet.setFillShader(new LinearGradient(0, 0, 0, 150, '#44ffffff', '#00ffffff', TileMode.CLAMP));
    //             chartSet.setValueTextColors(['white']);
    //             chartSet.setValueFormatter({
    //                 getFormattedValue(value, entry) {
    //                     return formatValueToUnit(value, UNITS.Celcius);
    //                 }
    //             });
    //             chartSet.setMode(Mode.CUBIC_BEZIER);
    //             chart.setData(new LineData([chartSet]));
    //         } else {
    //             chartSet.setValues(currentWeather.hourly);
    //             chart.getData().notifyDataChanged();
    //             chart.notifyDataSetChanged();
    //         }
    //         // chart.getXAxis().setAxisMinimum(false);
    //     }
    // }

    async function searchCity() {
        try {
            const result = await showModal({ page: SelectCity, animated: true, fullscreen: true });
            clog('searchCity', result);
            if (result) {
                saveLocation(result);
            }
        } catch (err) {
            showError(err);
        }
    }

    // async function getLocationAndWeather() {
    //     const result = await confirm;
    //     // clog('getLocationAndWeather', networkService.connected);
    //     if (!networkService.connected) {
    //         showSnack({ view: page.nativeView, message: l('no_network') });
    //     }
    //     try {
    //         const permRes = await requestPerm('location');
    //         clog('permRes', permRes);
    //         if (permRes[0] !== 'authorized') {
    //             return alert(l('missing_location_perm'));
    //         }
    //         // clog('requesting location');
    //         loading = true;
    //         if (!gps) {
    //             gps = new GPS();
    //         }
    //         const location = await gps.getCurrentLocation<LatLonKeys>({ timeout: 30000 });
    //         if (location) {
    //             // clog('location', location);
    //             const cityRes = await getCityName(location);
    //             if (cityRes) {
    //                 saveLocation(cityRes);
    //             }
    //         }
    //     } catch (err) {
    //         showError(err);
    //         // refresh using last location?
    //         refreshWeather();
    //     } finally {
    //         loading = false;
    //     }
    // }

    function refresh() {
        clog('refresh', weatherLocation);
        if (weatherLocation) {
            refreshWeather();
            // } else {
            // getLocationAndWeather();
        } else {

        }
    }

    function itemTemplateSelector(item, index, items) {
        return index === 0 ? 'topView' : (index === 1 ? 'info' : 'daily');
    }

    function onDailyLongPress(item) {
        const index = item.index;
        console.log('onDailyLongPress', index, item.index, item.scrollIndex);
        if (index) {
            item.showHourly = !item.showHourly;
            items.setItem(index, item);
        }
    }

    onMount(() => {
        networkService.on('connection', event => {
            if (event.connected && !lastUpdate || Date.now() - lastUpdate > 10 * 60 * 1000) {
                refresh();
            }
        });
        networkService.start(); // should send connection event and then refresh

        if (dsWeather) {
            items = prepareItems();
        }
    });
</script>

<page class="page" actionBarHidden="true" statusBarStyle="dark" navigationBarColor="black" statusBarColor="black" backgroundColor="black">

    <gridLayout rows="auto,*" backgroundColor="black">
        <!-- <gridLayout rows="auto,*" columns="*,auto" padding="10" backgroundColor="#424242"> -->
        <CActionBar title={weatherLocation && weatherLocation.name} row="0" colSpan="2" backgroundColor="black">
            <button variant="flat" class="icon-btn" text="mdi-refresh" on:tap={refresh} />
            <button variant="flat" class="icon-btn" text="mdi-magnify" on:tap={searchCity} />
            <button variant="flat" class="icon-btn" text="mdi-dots-vertical" />
        </CActionBar>
        <collectionview row="1" {items} {itemTemplateSelector}>
            <Template key="topView" let:item>
                <TopWeatherView {item} height={topHeight} />
            </Template>
            <Template key="info" let:item>
                <stacklayout row="2" colSpan="2" borderRadius="4" backgroundColor="#222" orientation="horizontal" verticalAlignment="center" margin="10" padding="10" width="100%">
                    <WeatherIcon verticalAlignment="middle" fontSize="50" icon={item.icon} autoPlay="true" />
                    <label fontSize="18" paddingLeft="4" verticalAlignment="middle" text={item.summary} />
                </stacklayout>
            </Template>
            <Template key="daily" let:item>
                <DailyView {item} on:longPress={()=>onDailyLongPress(item)}/>
            </Template>
        </collectionview>
        <!-- </gridLayout> -->
        <!-- <scrollview row="1">
            <gridlayout row="1" height={bottomHeight + (gVars.isAndroid ? 70 : 115)} rows="*,200,200">
                <linechart row="1" bind:this={lineChart} verticalAlignment="bottom" height="200" />
                <HourlyView items={hourlyItems} {scrollIndex} />
            </gridlayout>
        </scrollview> -->

        <!-- {#if prevDayData}
            <stacklayout rowSpan="2" elevation="2" width="60" height="60" horizontalAlignment="left" verticalAlignment="center" borderRadius="6" backgroundColor="#333" on:tap={decrementDay}>
                <WeatherIcon icon={prevDayData.icon} verticalAlignment="center" />
            </stacklayout>
        {/if}
        {#if nextDayData}
            <stacklayout rowSpan="2" elevation="2" width="60" height="60" horizontalAlignment="right" verticalAlignment="center" borderRadius="6" backgroundColor="#333" on:tap={incrementDay}>
                <WeatherIcon icon={nextDayData.icon} verticalAlignment="center" />
            </stacklayout>
        {/if} -->
        <activityIndicator row="0" colSpan="3" busy={loading} verticalAlignment="center" horizontalAlignment="center" visibily={loading ? 'visible' : 'collapsed'} />
    </gridLayout>
</page>
