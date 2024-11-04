import { app, BrowserWindow } from 'electron';
import path, { dirname } from 'path';
import express from 'express';
import bodyParser from 'body-parser';
import fetch from 'node-fetch';
import xml2js from 'xml2js';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import Store from 'electron-store';

(async () => {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const userDocumentsPath = app.getPath('documents');

    const server = express();
    const PORT = 3005;

    const store = new Store();
    let urlConfig = store.get('urlConfig', []);
    let pollInterval = store.get('pollInterval', 60000);

    server.use(bodyParser.json());
    server.use(express.static(path.join(__dirname, 'react-ui', 'build')));

    server.get('/api/config', (req, res) => {
      res.json({ urlConfig, pollInterval });
    });

    server.post('/api/setRefresh', async (req, res) => {
      pollInterval = req.body.pollInterval;
      store.set('pollInterval', pollInterval);
      res.json({ message: 'Polling interval updated', urlConfig });
      startPolling();
    });

    server.post('/api/refresh', (req, res) => {
      poll();
      res.status(200).send();
    });

    server.post('/api/config', async (req, res) => {
      const { latitude, longitude, name } = req.body;
      urlConfig = [...urlConfig, { latitude, longitude, name }];
      store.set('urlConfig', urlConfig);
      res.json({ message: 'Configuration updated', urlConfig });
      startPolling();
    });

    server.delete('/api/config', (req, res) => {
      const { name } = req.body;
      urlConfig = urlConfig.filter(entry => entry.name !== name);
      store.set('urlConfig', urlConfig);
      res.json({ message: 'Location deleted', urlConfig });
    });

    // Utility to convert Celsius to Fahrenheit
    function convertCtoF(valueWithUnit) {
      // Check if the input contains 'C'
      if (typeof valueWithUnit === 'string' && valueWithUnit.trim().endsWith('C')) {
        // Extract the numeric part and convert to Fahrenheit
        const celsius = parseFloat(valueWithUnit);
        return (celsius * 9 / 5) + 32 + 'F';
      }
      // If it's not in Celsius or the format is wrong, return the input as is
      return valueWithUnit;
    }

    // Sanitize XML tag names by removing spaces and invalid characters
    function sanitizeXmlTagName(tagName) {
      // Replace spaces with underscores
      let sanitized = tagName.replace(/\s+/g, '_');

      // Replace invalid characters (anything not a-z, A-Z, 0-9, or _) with an underscore
      sanitized = sanitized.replace(/[^\w]/g, '_');

      // Ensure the tag name starts with a letter (prefix with an underscore if necessary)
      if (/^[^a-zA-Z]/.test(sanitized)) {
        sanitized = `_${sanitized}`;
      }

      return sanitized;
    }

    async function fetchNWSData(latitude, longitude) {
      try {
        const userAgent = 'github.com/brandonemlaw';
    
        const pointResponse = await fetch(`https://api.weather.gov/points/${latitude},${longitude}`, {
          headers: {
            'User-Agent': userAgent
          }
        });
        
        if (!pointResponse.ok) {
          throw new Error(`Error fetching point data: ${pointResponse.statusText}`);
        }
        
        const pointData = await pointResponse.json();
    
        // Get forecast and hourly forecast URLs
        const forecastUrl = pointData.properties.forecast;
        const hourlyUrl = pointData.properties.forecastHourly;
    
        // Get the observation stations URL
        const observationStationsUrl = pointData.properties.observationStations;
        const stationListResponse = await fetch(observationStationsUrl, {
          headers: {
            'User-Agent': userAgent
          }
        });
    
        if (!stationListResponse.ok) {
          throw new Error(`Error fetching station list: ${stationListResponse.statusText}`);
        }
    
        const stationListData = await stationListResponse.json();
    
        // Extract the first station ID from the features list
        const firstStation = stationListData.features[0];
        if (!firstStation) {
          throw new Error("No observation stations found.");
        }
    
        const stationId = firstStation.id; // e.g., 'https://api.weather.gov/stations/KSRC'
    
        // Fetch the current conditions for the first station
        const currentConditionsUrl = `${stationId}/observations/latest`;
        const currentConditionsResponse = await fetch(currentConditionsUrl, {
          headers: {
            'User-Agent': userAgent
          }
        });
    
        if (!currentConditionsResponse.ok) {
          throw new Error(`Error fetching current conditions: ${currentConditionsResponse.statusText}`);
        }
    
        const currentData = await currentConditionsResponse.json();
    
        // Fetch forecast and hourly forecast data
        const [forecastResponse, hourlyResponse] = await Promise.all([
          fetch(forecastUrl, {
            headers: {
              'User-Agent': userAgent
            }
          }),
          fetch(hourlyUrl, {
            headers: {
              'User-Agent': userAgent
            }
          })
        ]);
    
        if (!forecastResponse.ok || !hourlyResponse.ok) {
          throw new Error('Error fetching forecast or hourly forecast data');
        }
    
        const forecastData = await forecastResponse.json();
        const hourlyData = await hourlyResponse.json();
    
        return { forecastData, hourlyData, currentData };
      } catch (error) {
        console.error('Error fetching NWS data:', error);
        return null;
      }
    }

    // Format the hourly forecast based on absolute and relative time
    function formatHourlyForecast(hourlyData) {
      const hourlyForecast = {};
      hourlyData.properties.periods.forEach((period, index) => {
        const startTime = new Date(period.startTime);
        const relativeTime = calcRelativeTime(startTime, index);
        const absoluteTime = formatAbsoluteTimeForHourly(startTime, period.name);

        // Convert temperature to Fahrenheit
        const temperatureF = convertCtoF(period.temperature, period.temperatureUnit);

        // Sanitize the time labels for XML tag names
        const sanitizedAbsoluteTime = sanitizeXmlTagName(absoluteTime);
        const sanitizedRelativeTime = sanitizeXmlTagName(relativeTime);

        // Add both absolute and relative versions to the forecast
        hourlyForecast[sanitizedAbsoluteTime] = {
          StartTime: period.name, // Use the NWS-provided human-readable name
          Temperature: temperatureF,
          TemperatureUnit: 'F',
          WindSpeed: period.windSpeed,
          WindDirection: period.windDirection,
          Condition: period.shortForecast,
          Icon: period.icon,
        };

        hourlyForecast[sanitizedRelativeTime] = {
          StartTime: period.name, // Use the NWS-provided human-readable name
          Temperature: temperatureF,
          TemperatureUnit: 'F',
          WindSpeed: period.windSpeed,
          WindDirection: period.windDirection,
          Condition: period.shortForecast,
          Icon: period.icon,
        };
      });
      return hourlyForecast;
    }

    // Function to format the daily forecast based on merged day/night periods
    function formatDailyForecast(forecastData) {
      const dailyForecast = {};
      const periods = forecastData.properties.periods;
      let startIndex = 0;

      // Determine if we start from day or night and skip the first night if necessary
      if (periods[0].isDaytime === false) {
        startIndex = 1; // Skip the first night
      }

      // Loop through the forecast periods two at a time (day and night)
      for (let i = startIndex; i < periods.length - 1; i += 2) {
        const dayPeriod = periods[i];
        const nightPeriod = periods[i + 1];

        // Ensure that dayPeriod is actually a daytime forecast and nightPeriod is nighttime
        if (dayPeriod.isDaytime && !nightPeriod.isDaytime) {
          const dayStartTime = new Date(dayPeriod.startTime);
          const dayAbsoluteTime = formatAbsoluteTimeForDaily(dayStartTime, dayPeriod.name);
          const sanitizedAbsoluteTime = sanitizeXmlTagName(dayAbsoluteTime);

          // Convert temperatures to Fahrenheit
          const dayTemperatureF = convertCtoF(dayPeriod.temperature, dayPeriod.temperatureUnit);
          const nightTemperatureF = convertCtoF(nightPeriod.temperature, dayPeriod.temperatureUnit);

          // Merge day and night into a single daily forecast entry
          dailyForecast[sanitizedAbsoluteTime] = {
            StartTime: dayPeriod.name, // Human-readable day name
            HighTemperature: dayTemperatureF,
            LowTemperature: nightTemperatureF,
            TemperatureUnit: 'F',
            DayWindSpeed: dayPeriod.windSpeed,
            DayWindDirection: dayPeriod.windDirection,
            NightWindSpeed: nightPeriod.windSpeed,
            NightWindDirection: nightPeriod.windDirection,
            DayChanceOfPrecipitation: dayPeriod.probabilityOfPrecipitation ? `${dayPeriod.probabilityOfPrecipitation.value}%` : 'N/A',
            NightChanceOfPrecipitation: nightPeriod.probabilityOfPrecipitation ? `${nightPeriod.probabilityOfPrecipitation.value}%` : 'N/A',
            DayDetailedForecast: dayPeriod.detailedForecast,
            NightDetailedForecast: nightPeriod.detailedForecast,
          };
        }
      }

      return dailyForecast;
    }

    // Function to format the day and night forecast with DayX and NightX labels
    function formatDayAndNightForecast(forecastData) {
      const dailyForecast = {};
      const periods = forecastData.properties.periods;
      let dayCount = 0; // Counter for day periods (Day1, Day2, etc.)
      let nightCount = 0; // Counter for night periods (Night1, Night2, etc.)
      let periodIndex = 0; // To track the actual index in case we skip the first night

      // Iterate through each forecast period
      periods.forEach((period, index) => {

        const startTime = new Date(period.startTime);
        const absoluteTime = formatAbsoluteTimeForDayAndNight(startTime, period.name);

        // Convert temperature to Fahrenheit
        const temperatureF = convertCtoF(period.temperature);

        // Sanitize the time labels for XML tag names
        const sanitizedAbsoluteTime = sanitizeXmlTagName(absoluteTime);
        
        // Determine if this is a day or night period and assign the correct label
        if (period.isDaytime) {
          dayCount++;
          const relativeTime = `Day${dayCount}`;
          const sanitizedRelativeTime = sanitizeXmlTagName(relativeTime);

          dailyForecast[sanitizedAbsoluteTime] = {
            StartTime: period.name, // Use the NWS-provided human-readable name
            Temperature: temperatureF,
            TemperatureUnit: 'F',
            WindSpeed: period.windSpeed,
            WindDirection: period.windDirection,
            ChanceOfPrecipitation: period.probabilityOfPrecipitation ? `${period.probabilityOfPrecipitation.value}%` : 'N/A',
            DetailedForecast: period.detailedForecast,
          };

          dailyForecast[sanitizedRelativeTime] = dailyForecast[sanitizedAbsoluteTime];
        } else {
          // Only assign a night period after the first day has been assigned (if necessary)
          if (dayCount > 0) {
            nightCount++;
            const relativeTime = `Night${nightCount}`;
            const sanitizedRelativeTime = sanitizeXmlTagName(relativeTime);

            dailyForecast[sanitizedAbsoluteTime] = {
              StartTime: period.name, // Use the NWS-provided human-readable name
              Temperature: temperatureF,
              TemperatureUnit: 'F',
              WindSpeed: period.windSpeed,
              WindDirection: period.windDirection,
              ChanceOfPrecipitation: period.probabilityOfPrecipitation ? `${period.probabilityOfPrecipitation.value}%` : 'N/A',
              DetailedForecast: period.detailedForecast,
            };

            dailyForecast[sanitizedRelativeTime] = dailyForecast[sanitizedAbsoluteTime];
          }
        }
      });

      return dailyForecast;
    }

    // Format the current conditions, converting temperature to Fahrenheit
    function formatCurrentConditions(currentData) {
      const tempC = currentData.properties.temperature.value;
      const tempF = convertCtoF(tempC);

      return {
        Temperature: tempF || 'N/A',
        TemperatureUnit: 'F',
        WindSpeed: currentData.properties.windSpeed.value ? `${currentData.properties.windSpeed.value} km/h` : 'N/A',
        WindDirection: currentData.properties.windDirection.value || 'N/A',
        Humidity: currentData.properties.relativeHumidity.value ? `${currentData.properties.relativeHumidity.value}%` : 'N/A',
        Condition: currentData.properties.textDescription || 'N/A',
      };
    }

    // Helper to format absolute time labels for XML keys
    function formatAbsoluteTimeForDayAndNight(startTime, dayName) {
      const dateOptions = { month: 'short', day: 'numeric', year: 'numeric' };
      
      // Format date
      const datePart = startTime.toLocaleDateString('en-US', dateOptions).replace(/, /g, '_');
      
      // Get the hour (24-hour format)
      const hours = startTime.getHours();
      
      // Determine whether it's Day or Night
      const dayOrNight = (hours >= 6 && hours < 18) ? 'Day' : 'Night';
      
      return `${datePart}_${dayOrNight}`;
    }

    // Helper to format absolute time labels for XML keys
    function formatAbsoluteTimeForHourly(startTime, dayName) {
      const dateOptions = { month: 'short', day: 'numeric', year: 'numeric' };
      const timeOptions = { hour: 'numeric', hour12: true };
    
      // Format date
      const datePart = startTime.toLocaleDateString('en-US', dateOptions).replace(/, /g, '_');
    
      // Format time and remove minute part (since you only want the hour and AM/PM)
      let timePart = startTime.toLocaleTimeString('en-US', timeOptions);
    
      // Replace space with underscore and convert to uppercase for AM/PM
      timePart = timePart.replace(' ', '_').toUpperCase(); 
    
      return `${datePart}_${timePart}`;
    }

    function formatAbsoluteTimeForDaily(startTime) {
      const dateOptions = { month: 'short', day: 'numeric', year: 'numeric' };
    
      // Format date
      const datePart = startTime.toLocaleDateString('en-US', dateOptions).replace(/, /g, '_');
      return datePart;
    }

    // Helper to calculate relative time labels for XML keys
    function calcRelativeTime(startTime, index) {
      const now = Date.now();
      const diff = startTime - now;
      const hours = Math.floor(diff / (1000 * 60 * 60));
      return hours < 0 ? 'Now' : `${hours}Hrs`;
    }

    async function poll() {
      if (urlConfig.length === 0) return;

      function sanitizeFileName(value) {
        return value.replace(/[\/\\,:.]/g, '-');
      }

      for (const entry of urlConfig) {
        const { latitude, longitude, name } = entry;
        try {
          console.log(`Polling NWS data for ${name} at ${latitude}, ${longitude}`);
          const data = await fetchNWSData(latitude, longitude);
          if (!data) continue;

          const { forecastData, hourlyData, currentData } = data;

          const hourlyForecast = formatHourlyForecast(hourlyData);
          const dayAndNightForecast = formatDayAndNightForecast(forecastData);
          const dailyForecast = formatDailyForecast(forecastData);
          const currentConditions = formatCurrentConditions(currentData);

          await fs.mkdir(path.join(userDocumentsPath, 'NWSForecastXMLFiles'), { recursive: true });

          // Build XML for Hourly Forecast (Absolute and Relative)
          const hourlyBuilder = new xml2js.Builder({ headless: true });
          const hourlyXml = hourlyBuilder.buildObject({ HourlyForecast: hourlyForecast });

          // Build XML for Daily/Period Forecast (Absolute and Relative)
          const dailyBuilder = new xml2js.Builder({ headless: true });
          const dailyXml = dailyBuilder.buildObject({ DailyForecast: dailyForecast });

          // Build XML for Daily/Period Forecast (Absolute and Relative)
          const dayAndNightBuilder = new xml2js.Builder({ headless: true });
          const dayAndNightXml = dayAndNightBuilder.buildObject({ DayAndNightForecast: dayAndNightForecast });

          // Build XML for Current Conditions
          const currentBuilder = new xml2js.Builder({ headless: true });
          const currentXml = currentBuilder.buildObject({ CurrentConditions: currentConditions });

          // Write files
          const sanitizedFileName = sanitizeFileName(name);
          await writeFile(`${sanitizedFileName}-HourlyForecast.xml`, hourlyXml);
          await writeFile(`${sanitizedFileName}-DayAndNightForecast.xml`, dayAndNightXml);
          await writeFile(`${sanitizedFileName}-DailyForecast.xml`, dailyXml);
          await writeFile(`${sanitizedFileName}-CurrentConditions.xml`, currentXml);

          console.log(`Data for ${name} written successfully.`);
        } catch (error) {
          console.error(`Error polling data for ${name}:`, error);
        }
      }
      setTimeout(poll, pollInterval);
    }

    async function writeFile(filename, content) {
      const filePath = path.join(userDocumentsPath, 'NWSForecastXMLFiles', filename);
      await fs.writeFile(filePath, content);
      console.log(`File written to ${filePath}`);
    }

    async function startPolling() {
      if (urlConfig.length === 0) {
        console.log("No locations configured for polling.");
        return;
      }

      console.log("Starting polling with an interval of", pollInterval, "milliseconds.");

      setTimeout(poll, pollInterval); // Poll initially after the interval

      // Immediately call the polling function the first time
      poll().catch(error => {
        console.error('Polling error:', error);
      });
    }

    app.on('ready', () => {
      console.log('Electron app is ready.');

      server.listen(PORT, () => {
        console.log(`Server running at http://localhost:${PORT}`);
      });

      const win = new BrowserWindow({
        width: 600,
        height: 700,
        webPreferences: {
          preload: path.join(__dirname, 'preload.js'),
          contextIsolation: true,
        },
      });

      win.loadURL(`http://localhost:${PORT}`);
      startPolling();
    });

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        app.quit();
      }
    });

  } catch (error) {
    console.error('Error during initialization:', error);
  }
})();