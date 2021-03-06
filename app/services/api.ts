import * as http from '@nativescript/core/http';
import { CustomError } from '~/utils/error';
import { device } from '@nativescript/core/platform';
import { getString } from '@nativescript/core/application-settings';
import { connectionType, getConnectionType, startMonitoring, stopMonitoring } from '@nativescript/core/connectivity';

import { EventData, Observable } from '@nativescript/core/data/observable';
import { clog } from '~/utils/logging';
import { IMapPos } from '~/helpers/geo';
import { CityWeather, Coord, ListWeather } from './owm';
import dayjs from 'dayjs';
// const { getSunrise, getSunset } = require('sunrise-sunset-js');
import { UNITS, colorForIcon, colorFromTempC, convertTime, formatValueToUnit, kelvinToCelsius, lang, titlecase } from '~/helpers/formatter';
import { Photon } from './photon';
import { DarkSky } from './darksky';

import Color from 'tinycolor2';

const dsApiKey = getString('dsApiKey', DARK_SKY_KEY);

type HTTPOptions = http.HttpRequestOptions;

export const NetworkConnectionStateEvent = 'NetworkConnectionStateEvent';
export interface NetworkConnectionStateEventData extends EventData {
    data: {
        connected: boolean;
        connectionType: connectionType;
    };
}

export interface HttpRequestOptions extends HTTPOptions {
    queryParams?: {};
}

function isDayTime(sunrise, sunset, time) {
    // const sunrise = weatherData.sunrise;
    // const sunset = weatherData.sunset;
    if (sunrise && sunset) {
        return time.isBefore(sunset) && time.isAfter(sunrise);
    } else {
        // fallback
        const hourOfDay = time.get('h');
        return hourOfDay >= 7 && hourOfDay < 20;
    }
}

function timeout(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function queryString(params, location) {
    const obj = {};
    let i, len, key, value;

    if (typeof params === 'string') {
        value = location.match(new RegExp('[?&]' + params + '=?([^&]*)[&#$]?'));
        return value ? value[1] : undefined;
    }

    const locSplit = location.split(/[?&]/);
    // _params[0] is the url

    const parts = [];
    for (i = 0, len = locSplit.length; i < len; i++) {
        const theParts = locSplit[i].split('=');
        if (!theParts[0]) {
            continue;
        }
        if (theParts[1]) {
            parts.push(theParts[0] + '=' + theParts[1]);
        } else {
            parts.push(theParts[0]);
        }
    }
    if (Array.isArray(params)) {
        let data;

        for (i = 0, len = params.length; i < len; i++) {
            data = params[i];
            if (typeof data === 'string') {
                parts.push(data);
            } else if (Array.isArray(data)) {
                parts.push(data[0] + '=' + data[1]);
            }
        }
    } else if (typeof params === 'object') {
        for (key in params) {
            value = params[key];
            if (typeof value === 'undefined') {
                delete obj[key];
            } else {
                if (typeof value === 'object') {
                    obj[key] = encodeURIComponent(JSON.stringify(value));
                } else {
                    obj[key] = encodeURIComponent(value);
                }
            }
        }
        for (key in obj) {
            parts.push(key + (obj[key] === true ? '' : '=' + obj[key]));
        }
    }

    return parts.splice(0, 2).join('?') + (parts.length > 0 ? '&' + parts.join('&') : '');
}

export class TimeoutError extends CustomError {
    constructor(props?) {
        super(
            Object.assign(
                {
                    message: 'timeout_error'
                },
                props
            ),
            'TimeoutError'
        );
    }
}

export class NoNetworkError extends CustomError {
    constructor(props?) {
        super(
            Object.assign(
                {
                    message: 'no_network'
                },
                props
            ),
            'NoNetworkError'
        );
    }
}
export interface HTTPErrorProps {
    statusCode: number;
    message: string;
    requestParams: HTTPOptions;
}
export class HTTPError extends CustomError {
    statusCode: number;
    requestParams: HTTPOptions;
    constructor(props: HTTPErrorProps | HTTPError) {
        super(
            Object.assign(
                {
                    message: 'httpError'
                },
                props
            ),
            'HTTPError'
        );
    }
}

interface NetworkService {
    // on(eventNames: 'connection', callback: (e: EventData & { connectionType: connectionType; connected: boolean }) => void, thisArg?: any);
}

class NetworkService extends Observable {
    _connectionType: connectionType = connectionType.none;
    _connected = false;
    get connected() {
        return this._connected;
    }
    set connected(value: boolean) {
        if (this._connected !== value) {
            this._connected = value;
            this.notify({
                eventName: NetworkConnectionStateEvent,
                object: this,
                data: {
                    connected: value,
                    connectionType: this._connectionType
                }
            } as NetworkConnectionStateEventData);
        }
    }
    get connectionType() {
        return this._connectionType;
    }
    set connectionType(value: connectionType) {
        if (this._connectionType !== value) {
            this._connectionType = value;
            this.connected = value !== connectionType.none;
            this.notify({ eventName: 'connection', object: this, connectionType: value, connected: this.connected });
        }
    }
    log(...args) {
        clog(`[${this.constructor.name}]`, ...args);
    }
    monitoring = false;
    start() {
        if (this.monitoring) {
            return;
        }
        this.monitoring = true;
        startMonitoring(this.onConnectionStateChange.bind(this));
        this.connectionType = getConnectionType();
    }
    stop() {
        if (!this.monitoring) {
            return;
        }
        this.monitoring = false;
        stopMonitoring();
    }
    onConnectionStateChange(newConnectionType: connectionType) {
        this.connectionType = newConnectionType;
    }
}

export const networkService = new NetworkService();

async function handleRequestRetry(requestParams: HttpRequestOptions, retry = 0) {
    throw new HTTPError({
        statusCode: 401,
        message: 'HTTP error',
        requestParams
    });
}

async function handleRequestResponse(response: http.HttpResponse, requestParams: HttpRequestOptions, requestStartTime, retry) {
    const statusCode = response.statusCode;
    // return Promise.resolve()
    // .then(() => {
    let jsonContent;
    let content;
    try {
        jsonContent = response.content.toJSON();
    } catch (e) {
        // console.log('failed to parse result to JSON', e);
        content = response.content;
    }
    // const isJSON = !!jsonContent;
    clog('handleRequestResponse response', statusCode, Math.round(statusCode / 100), typeof content);
    if (Math.round(statusCode / 100) !== 2) {
        // let jsonReturn;
        if (!jsonContent) {
            // jsonReturn = jsonContent;
            // } else {
            // try {
            // jsonReturn = JSON.parse(content);
            // } catch (err) {
            // error result might html
            const match = /<title>(.*)\n*<\/title>/.exec(content);
            clog('request error1', content, match);
            return Promise.reject(
                new HTTPError({
                    statusCode,
                    message: match ? match[1] : content.toString(),
                    requestParams
                })
            );
            // }
        } else {
            if (Array.isArray(jsonContent)) {
                jsonContent = jsonContent[0];
            }
            if (statusCode === 401 && jsonContent.error === 'invalid_grant') {
                return this.handleRequestRetry(requestParams, retry);
            }
            const error = jsonContent.error_description || jsonContent.error || jsonContent;
            clog('throwing http error', error.code || statusCode, error.error_description || error.form || error.message || error.error || error);
            throw new HTTPError({
                statusCode: error.code || statusCode,
                message: error.error_description || error.form || error.message || error.error || error,
                requestParams
            });
        }
    }
    // if (isJSON) {
    return jsonContent || content;
    // }
    // try {
    //     return response.content.toJSON();
    // } catch (e) {
    //     // console.log('failed to parse result to JSON', e);
    //     return response.content;
    // }
    // })
    // .catch(err => {
    //     const delta = Date.now() - requestStartTime;
    //     if (delta >= 0 && delta < 500) {
    //         return timeout(delta).then(() => Promise.reject(err));
    //     } else {
    //         return Promise.reject(err);
    //     }
    // });
}
function getRequestHeaders(requestParams?: HttpRequestOptions) {
    const headers = requestParams?.headers ?? {};
    if (!headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
    }

    return headers;
}
export function request<T = any>(requestParams: HttpRequestOptions, retry = 0) {
    if (!networkService.connected) {
        throw new NoNetworkError();
    }
    if (requestParams.queryParams) {
        requestParams.url = queryString(requestParams.queryParams, requestParams.url);
        delete requestParams.queryParams;
    }
    requestParams.headers = getRequestHeaders(requestParams);

    clog('request', requestParams);
    const requestStartTime = Date.now();
    return http.request(requestParams).then(response => handleRequestResponse(response, requestParams, requestStartTime, retry)) as Promise<T>;
}

const apiKey = getString('apiKey', OWM_KEY);

export interface OWMParams extends Partial<IMapPos> {
    // pos?: IMapPos;
    id?: number; // cityId
    q?: string; // search query
}
export async function fetchOWM(apiName: string, queryParams: OWMParams = {}) {
    clog('fetchOWM', apiName, queryParams);
    return request({
        url: `https://api.openweathermap.org/data/2.5/${apiName}`,
        method: 'GET',
        queryParams: {
            lang,
            appid: apiKey,
            ...queryParams
        }
    });
}

export async function getCityName(pos: Coord) {
    clog('getCityName', pos);
    const result: CityWeather = await fetchOWM('weather', {
        lat: pos.lat,
        lon: pos.lon
    });
    console.log('fetchOWM', 'done', result);

    return result;
}
// export async function findCitiesByName(q: string) {
//     clog('findCitiesByName', q);
//     const result: {
//         list: CityWeather[];
//     } = await fetchOWM('find', {
//         q
//     });
//     console.log('findCitiesByName', 'done', result);

//     return result.list;
// }

// export interface WeatherData {
//     date: dayjs.Dayjs;
//     sunrise: dayjs.Dayjs;
//     sunset: dayjs.Dayjs;
//     temp: string;
//     tempC: number;
//     feels_like: string;
//     feels_likeC: number;
//     pressure: string;
//     pressureHpa: number;
//     humidity: string;
//     humidityPerc: number;
//     desc: string;
//     id: number;
//     icon: string;
//     windSpeed: string;
//     windSpeedKMH: number;
//     windDeg: number;
//     fallPHour: number;
//     fallDesc: string;
//     frontAlpha: number;
//     tempColor: string;
//     // nightTime
// }

// export async function getForecast(cityId: number) {
//     clog('getForecast', cityId);
//     const result = (await fetchOWM('forecast', {
//         id: cityId
//     })) as {
//         city: {
//             coord: {
//                 lat: number;
//                 lon: number;
//             };
//         };
//         list: ListWeather[];
//     };

//     let sunrise;
//     let sunset;
//     let lastDateStart: dayjs.Dayjs;
//     const lat = result.city.coord.lat;
//     const lon = result.city.coord.lon;

//     const results: WeatherData[][] = [];
//     let weatherResult: WeatherData[];
//     result.list.forEach(result => {
//         const dateDate = new Date(result.dt * 1000);
//         const date = dayjs(result.dt * 1000);
//         const dateStart = date.startOf('d');
//         if (!lastDateStart || !lastDateStart.isSame(dateStart)) {
//             weatherResult = [];
//             results.push(weatherResult);
//             sunrise = dayjs(getSunrise(lat, lon, dateDate));
//             sunset = dayjs(getSunset(lat, lon, dateDate));
//             lastDateStart = dateStart;
//         }
//         const rain = result.rain ? result.rain['3h'] || result.rain['1h'] || 0 : 0;
//         const snow = result.snow ? result.snow['3h'] || result.snow['1h'] || 0 : 0;
//         const icon = result.weather[0].icon.slice(0, 2) + (isDayTime(sunrise, sunset, date) ? 'd' : 'n');
//         const fallPHour = rain > 0 ? rain : snow;
//         const temp = result.main.temp;
//         weatherResult.push({
//             date,
//             sunrise,
//             sunset,
//             temp: formatValueToUnit(temp, UNITS.Celcius),
//             tempC: kelvinToCelsius(temp),
//             feels_like: formatValueToUnit(result.main.feels_like, UNITS.Celcius),
//             feels_likeC: result.main.feels_like,
//             pressure: formatValueToUnit(result.main.pressure, UNITS.hPa),
//             pressureHpa: result.main.pressure,
//             humidity: result.main.humidity + '%',
//             humidityPerc: result.main.humidity,
//             desc: titlecase(result.weather[0].description),
//             id: result.weather[0].id,
//             icon,
//             windSpeed: formatValueToUnit(result.wind.speed, UNITS.Speed),
//             windSpeedKMH: result.wind.speed,
//             windDeg: result.wind.deg,
//             fallPHour,
//             fallDesc: formatValueToUnit(fallPHour, UNITS.MM),
//             frontAlpha: Math.min(fallPHour / 5, 1),
//             tempColor: colorFromTempC(kelvinToCelsius(temp))
//             // nightTime
//         });
//         // clog(convertTime(date, 'dddd MMM D HH:mm'), JSON.stringify(result), icon, JSON.stringify(weatherData));
//         // if (date.isBefore(tomorrow)) {
//         //     (weatherData.time = convertTime(date, 'HH:mm')), todayWeather.push(weatherData);
//         // } else if (date.isBefore(later)) {
//         //     (weatherData.time = convertTime(date, 'HH:mm')), tomorrowWeather.push(weatherData);
//         // } else {
//         //     (weatherData.time = convertTime(date, 'dddd MMM D HH:mm')), weather.push(weatherData);
//         // }
//     });
//     return results;
// }
const cardinals = ['wi-wind-north', 'wi-wind-north-east', 'wi-wind-east', 'wi-wind-south-east', 'wi-wind-south', 'wi-wind-south', 'wi-wind-west', 'wi-wind-north-west', 'wi-wind-north'];
function windIcon(degrees) {
    return cardinals[Math.round(((degrees + 180) % 360) / 45)];
}
export async function getDarkSkyWeather(lat, lon, queryParams = {}) {
    const result = await request<DarkSky>({
        url: `https://api.darksky.net/forecast/${dsApiKey}/${lat},${lon}`,
        method: 'GET',
        queryParams: {
            lang,
            units: 'ca',
            ...queryParams
        }
    });

    // console.log('getDarkSkyWeather', result.hourly.summary, result.currently.summary);
    result.currently && (result.currently.time *= 1000);
    result.daily.data.forEach(d => {
        d.time = d.time * 1000;
        d.sunriseTime = d.sunriseTime * 1000;
        d.sunsetTime = d.sunsetTime * 1000;
        d.windIcon = windIcon(d.windBearing);
        d.hourly = [];
    });
    // if (result.minutly) {
    //     result.daily.data[0].minutly = result.minutly;
    // }
    let dailyIndex = 0;
    let currentDateData = result.daily.data[dailyIndex] as any;
    if (result.hourly) {
        currentDateData.hourlyData = {
            icon: result.hourly.icon,
            summary: result.hourly.summary
        };
    }

    let dayEnd = dayjs(currentDateData.time).endOf('d');
    result.hourly.data.forEach((h, i) => {
        h.time = h.time * 1000;
        h.windIcon = windIcon(h.windBearing);
        const color = colorForIcon(h.icon);
        let alpha = 1;
        if (/rain|snow/.test(h.icon)) {
            alpha = h.precipProbability;
        } else if (/cloudy/.test(h.icon)) {
            alpha = h.cloudCover;
        }
        h.color = Color(color)
            .setAlpha(alpha)
            .toRgbString();
        const dateStart = dayjs(h.time).startOf('d');
        // console.log('handling hourly', i,dailyIndex, convertTime(h.time, 'dddd  HH:mm'),convertTime(dayEnd, 'dddd'),convertTime(dateStart, 'dddd'), dateStart.isBefore(dayEnd));
        if (!dateStart.isBefore(dayEnd)) {
            dailyIndex++;
            currentDateData = result.daily.data[dailyIndex];
            dayEnd = dayjs(currentDateData.time).endOf('d');
        }
        h.index = currentDateData.hourly.length;
        currentDateData.hourly.push(h);
    });
    delete result.hourly;
    return result;
}

export const defaultDarkSky = null as DarkSky;
export async function photonSearch(q, lat?, lon?, queryParams = {}) {
    return request({
        url: 'http://photon.komoot.de/api',
        method: 'GET',
        queryParams: {
            q,
            lat,
            lon,
            lang,
            limit: 40
        }
    }).then(function(results: Photon) {
        return (
            results.features
                // .filter(r => r.properties.osm_key === 'place' || r.properties.osm_key === 'natural')
                .map(f => ({
                    name: f.properties.name,
                    sys: f.properties,
                    coord: { lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] }
                }))
        );
    });
}
