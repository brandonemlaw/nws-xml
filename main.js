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
    let imageConfig = store.get('imageConfig', []);
    let imagePollInterval = store.get('imagePollInterval', 1800000); // Default 30 minutes

    server.use(bodyParser.json());
    server.use(express.static(path.join(__dirname, 'react-ui', 'build')));

    server.get('/api/config', (req, res) => {
      res.json({ urlConfig, pollInterval, imageConfig, imagePollInterval });
    });

    server.post('/api/setRefresh', async (req, res) => {
      pollInterval = req.body.pollInterval;
      store.set('pollInterval', pollInterval);
      res.json({ message: 'Polling interval updated', urlConfig, imageConfig });
      startPolling();
    });

    server.post('/api/setImageRefresh', async (req, res) => {
      imagePollInterval = req.body.imagePollInterval;
      store.set('imagePollInterval', imagePollInterval);
      res.json({ message: 'Image polling interval updated', imageConfig });
      startImagePolling();
    });

    server.post('/api/refresh', (req, res) => {
      poll();
      res.status(200).send();
    });

    server.post('/api/refreshImages', (req, res) => {
      pollImages();
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

    server.post('/api/imageConfig', async (req, res) => {
      const { url, name } = req.body;
      imageConfig = [...imageConfig, { url, name }];
      store.set('imageConfig', imageConfig);
      res.json({ message: 'Image configuration updated', imageConfig });
      startImagePolling();
    });

    server.delete('/api/imageConfig', (req, res) => {
      const { name } = req.body;
      imageConfig = imageConfig.filter(entry => entry.name !== name);
      store.set('imageConfig', imageConfig);
      res.json({ message: 'Image deleted', imageConfig });
    });

    // Utility to convert Celsius to Fahrenheit
    function convertCtoF(valueWithUnit) {
      // Check if the input contains 'C'
      if (typeof valueWithUnit === 'string' && valueWithUnit.trim().endsWith('C')) {
        // Extract the numeric part and convert to Fahrenheit
        const celsius = parseFloat(valueWithUnit);
        return (celsius * 9 / 5) + 32; // Remove 'F' suffix
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

    // Function to merge daily forecast and current conditions from NWS data
    function formatDailyForecast(forecastData, currentConditionsData) {
      const dailyForecastAbsolute = {};
      const dailyForecastRelative = {};
      const periods = forecastData.properties.periods;
      let startIndex = 0;
      let dayCounter = 0; // Counter to track Day1, Day2, etc.

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
              // Increment the day counter for each full day (day + night)
              dayCounter++;

              const dayStartTime = new Date(dayPeriod.startTime);
              const dayAbsoluteTime = formatAbsoluteTimeForDaily(dayStartTime, dayPeriod.name);
              const sanitizedAbsoluteTime = sanitizeXmlTagName(dayAbsoluteTime);

              // Convert temperatures to Fahrenheit
              const dayTemperatureF = convertCtoF(dayPeriod.temperature, dayPeriod.temperatureUnit);
              const nightTemperatureF = convertCtoF(nightPeriod.temperature, dayPeriod.temperatureUnit);

              // Combine PoP (Probability of Precipitation) by taking the maximum of day and night
              const dayPoP = dayPeriod.probabilityOfPrecipitation ? dayPeriod.probabilityOfPrecipitation.value : 0;
              const nightPoP = nightPeriod.probabilityOfPrecipitation ? nightPeriod.probabilityOfPrecipitation.value : 0;
              const maxPoP = Math.max(dayPoP, nightPoP);

              // Combine Wind Speed by taking the stronger wind
              const dayWindSpeed = extractWindSpeed(dayPeriod.windSpeed);
              const nightWindSpeed = extractWindSpeed(nightPeriod.windSpeed);
              const maxWindSpeed = Math.max(dayWindSpeed, nightWindSpeed);

              // Take the wind direction corresponding to the stronger wind
              const windDirection = (dayWindSpeed >= nightWindSpeed) ? dayPeriod.windDirection : nightPeriod.windDirection;

              const forecastData = {
                  StartTime: dayPeriod.name, // Human-readable day name
                  HighTemperature: dayTemperatureF,
                  LowTemperature: nightTemperatureF,
                  TemperatureUnit: 'F',
                  WindSpeed: `${maxWindSpeed} mph`,
                  WindDirection: windDirection, // Strongest wind direction
                  ChanceOfPrecipitation: `${maxPoP}%`, // Strongest PoP
                  DayDetailedForecast: dayPeriod.detailedForecast,
                  NightDetailedForecast: nightPeriod.detailedForecast,
                  DayShortForecast: dayPeriod.shortForecast, // Add short forecast (day)
                  NightShortForecast: nightPeriod.shortForecast, // Add short forecast (night)
                  DayIcon: convertIconLink(dayPeriod.icon),  // Local path for day icon
                  NightIcon: convertIconLink(nightPeriod.icon), // Local path for night icon
              };

              // Add to absolute forecast (by specific date)
              dailyForecastAbsolute[sanitizedAbsoluteTime] = forecastData;

              // Add to relative forecast (by day number)
              dailyForecastRelative[`Day${dayCounter}`] = { ...forecastData };
          }
      }

      // Add current conditions to both forecasts
      if (currentConditionsData) {
          const currentConditions = formatCurrentConditions(currentConditionsData);
          dailyForecastAbsolute['CurrentConditions'] = currentConditions;
          dailyForecastRelative['CurrentConditions'] = currentConditions;
      }

      return { absolute: dailyForecastAbsolute, relative: dailyForecastRelative };
    }

    // Function to format current conditions from NWS data
    function formatCurrentConditions(currentConditionsData) {
      const currentTempC = currentConditionsData.properties.temperature.value;
      // Convert Celsius to Fahrenheit properly (NWS API returns numeric values in Celsius)
      const currentTempF = currentTempC !== null ? (currentTempC * 9 / 5) + 32 : null;
      const weatherDescription = currentConditionsData.properties.textDescription;
      const windSpeed = currentConditionsData.properties.windSpeed.value;
      const windDirection = currentConditionsData.properties.windDirection.value;
      const iconLink = convertIconLink(currentConditionsData.properties.icon);

      return {
          Temperature: currentTempF !== null ? `${currentTempF.toFixed(0)}°` : 'N/A', // Remove F suffix
          WeatherDescription: weatherDescription || 'N/A',
          WindSpeed: windSpeed ? `${windSpeed.toFixed(0)} mph` : 'Calm',
          WindDirection: windDirection ? calcWind(windDirection) : 'N/A',
          Icon: iconLink, // Local path for current conditions icon
      };
    }

    // Function to convert NWS icon link to local path in ~/Documents/WeatherIcons/
    function convertIconLink(iconUrl) {
      // Extract the filename from the URL after the last '/'
      let iconFile = iconUrl.substring(iconUrl.lastIndexOf('/') + 1);
  
      // Remove any query parameters (like "?size=medium") by truncating at the first '?'
      const paramsIndex = iconFile.indexOf('?');
      if (paramsIndex > -1) {
          iconFile = iconFile.substring(0, paramsIndex);
      }
  
      // Remove any commas and numbers from the icon filename
      iconFile = iconFile.replace(/[,0-9]/g, '');
  
      // Determine if the icon is for nighttime
      const isNight = iconUrl.includes('night');
  
      // If it's a night icon, prepend 'night/' to the filename
      if (isNight) {
          iconFile = `night/${iconFile}`;
      }
  
      // Ensure the filename ends with .png
      if (!iconFile.endsWith('.png')) {
          iconFile += '.png';
      }
  
      // Return the cleaned-up local path
      return `/Users/brandonemlaw/Documents/WeatherIcons/${iconFile}`;
  }

    // Utility function to calculate wind direction from degrees
    function calcWind(windDegrees) {
      if (windDegrees > 348.75 || windDegrees < 11.25) return 'N';
      if (windDegrees > 11.25 && windDegrees < 33.75) return 'NNE';
      if (windDegrees > 33.75 && windDegrees < 56.25) return 'NE';
      if (windDegrees > 56.25 && windDegrees < 75) return 'ENE';
      if (windDegrees > 78.75 && windDegrees < 101.25) return 'E';
      if (windDegrees > 101.25 && windDegrees < 123.75) return 'ESE';
      if (windDegrees > 123.75 && windDegrees < 146.25) return 'SE';
      if (windDegrees > 146.25 && windDegrees < 168.75) return 'SSE';
      if (windDegrees > 168.75 && windDegrees < 191.25) return 'S';
      if (windDegrees > 191.25 && windDegrees < 213.75) return 'SSW';
      if (windDegrees > 213.75 && windDegrees < 236.25) return 'SW';
      if (windDegrees > 236.25 && windDegrees < 258.75) return 'WSW';
      if (windDegrees > 258.75 && windDegrees < 281.25) return 'W';
      if (windDegrees > 281.25 && windDegrees < 303.75) return 'WNW';
      if (windDegrees > 303.75 && windDegrees < 326.25) return 'NW';
      if (windDegrees > 326.25 && windDegrees < 348.75) return 'NNW';
      return '';
    }

    // Utility function to convert wind speed from string to number (mph)
    function extractWindSpeed(windSpeedStr) {
      const speedMatch = windSpeedStr.match(/\d+/);
      return speedMatch ? parseFloat(speedMatch[0]) : 0;
    }

    // Function to format the day and night forecast with DayX and NightX labels
    function formatDayAndNightForecast(forecastData) {
      const dayAndNightForecastAbsolute = {};
      const dayAndNightForecastRelative = {};
      const periods = forecastData.properties.periods;
      let dayCount = 0; // Counter for day periods (Day1, Day2, etc.)
      let nightCount = 0; // Counter for night periods (Night1, Night2, etc.)

      // Iterate through each forecast period
      periods.forEach((period, index) => {

        const startTime = new Date(period.startTime);
        const absoluteTime = formatAbsoluteTimeForDayAndNight(startTime, period.name);

        // Convert temperature to Fahrenheit
        const temperatureF = convertCtoF(period.temperature);

        // Sanitize the time labels for XML tag names
        const sanitizedAbsoluteTime = sanitizeXmlTagName(absoluteTime);
        
        const periodData = {
          StartTime: period.name, // Use the NWS-provided human-readable name
          Temperature: temperatureF,
          TemperatureUnit: 'F',
          WindSpeed: period.windSpeed,
          WindDirection: period.windDirection,
          ChanceOfPrecipitation: period.probabilityOfPrecipitation ? `${period.probabilityOfPrecipitation.value}%` : 'N/A',
          DetailedForecast: period.detailedForecast,
        };
        
        // Determine if this is a day or night period and assign the correct label
        if (period.isDaytime) {
          dayCount++;
          const relativeTime = `Day${dayCount}`;

          dayAndNightForecastAbsolute[sanitizedAbsoluteTime] = periodData;
          dayAndNightForecastRelative[relativeTime] = { ...periodData };
        } else {
          // Only assign a night period after the first day has been assigned (if necessary)
          if (dayCount > 0) {
            nightCount++;
            const relativeTime = `Night${nightCount}`;

            dayAndNightForecastAbsolute[sanitizedAbsoluteTime] = periodData;
            dayAndNightForecastRelative[relativeTime] = { ...periodData };
          }
        }
      });

      return { absolute: dayAndNightForecastAbsolute, relative: dayAndNightForecastRelative };
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
          const dayAndNightForecasts = formatDayAndNightForecast(forecastData);
          const dailyForecasts = formatDailyForecast(forecastData, currentData);
          const currentConditions = formatCurrentConditions(currentData);

          await fs.mkdir(path.join(userDocumentsPath, 'NWSForecastXMLFiles'), { recursive: true });

          // Build XML for Hourly Forecast (Absolute and Relative)
          const hourlyBuilder = new xml2js.Builder({ headless: true });
          const hourlyXml = hourlyBuilder.buildObject({ HourlyForecast: hourlyForecast });

          // Build XML for Daily Forecast - By Specific Date (Absolute)
          const dailyAbsoluteBuilder = new xml2js.Builder({ headless: true });
          const dailyAbsoluteXml = dailyAbsoluteBuilder.buildObject({ DailyForecast: dailyForecasts.absolute });

          // Build XML for Daily Forecast - By Days Out (Relative)
          const dailyRelativeBuilder = new xml2js.Builder({ headless: true });
          const dailyRelativeXml = dailyRelativeBuilder.buildObject({ DailyForecast: dailyForecasts.relative });

          // Build XML for Day and Night Forecast - By Specific Date (Absolute)
          const dayAndNightAbsoluteBuilder = new xml2js.Builder({ headless: true });
          const dayAndNightAbsoluteXml = dayAndNightAbsoluteBuilder.buildObject({ DayAndNightForecast: dayAndNightForecasts.absolute });

          // Build XML for Day and Night Forecast - By Days Out (Relative)
          const dayAndNightRelativeBuilder = new xml2js.Builder({ headless: true });
          const dayAndNightRelativeXml = dayAndNightRelativeBuilder.buildObject({ DayAndNightForecast: dayAndNightForecasts.relative });

          // Build XML for Current Conditions
          const currentBuilder = new xml2js.Builder({ headless: true });
          const currentXml = currentBuilder.buildObject({ CurrentConditions: currentConditions });

          // Write files
          const sanitizedFileName = sanitizeFileName(name);
          await writeFile(`${sanitizedFileName}-HourlyForecast.xml`, hourlyXml);
          await writeFile(`${sanitizedFileName}-DayAndNightForecast-BySpecificDate.xml`, dayAndNightAbsoluteXml);
          await writeFile(`${sanitizedFileName}-DayAndNightForecast-ByDaysOut.xml`, dayAndNightRelativeXml);
          await writeFile(`${sanitizedFileName}-DailyForecast-BySpecificDate.xml`, dailyAbsoluteXml);
          await writeFile(`${sanitizedFileName}-DailyForecast-ByDaysOut.xml`, dailyRelativeXml);
          await writeFile(`${sanitizedFileName}-CurrentConditions.xml`, currentXml);

          // --- NEW: Write alert XMLs for this location ---
          // (We call the alert polling for all locations after the forecast polling)
          await pollAlertsForLocations();
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

    async function downloadImage(url, filename) {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Error downloading image: ${response.statusText}`);
        }
        
        const buffer = await response.buffer();
        const imagePath = path.join(userDocumentsPath, 'NWSForecastImages', filename);
        
        // Ensure directory exists
        await fs.mkdir(path.dirname(imagePath), { recursive: true });
        
        // Write image file
        await fs.writeFile(imagePath, buffer);
        console.log(`Image downloaded to ${imagePath}`);
        return true;
      } catch (error) {
        console.error(`Error downloading image from ${url}:`, error);
        return false;
      }
    }

    async function pollImages() {
      if (imageConfig.length === 0) return;

      console.log('Polling images...');
      
      for (const entry of imageConfig) {
        const { url, name } = entry;
        try {
          // Determine file extension from URL or default to .jpg
          const urlParts = url.split('.');
          const extension = urlParts.length > 1 ? '.' + urlParts.pop() : '.jpg';
          const filename = name + extension;
          
          await downloadImage(url, filename);
        } catch (error) {
          console.error(`Error processing image ${name}:`, error);
        }
      }
      
      setTimeout(pollImages, imagePollInterval);
    }

    async function startImagePolling() {
      if (imageConfig.length === 0) {
        console.log("No images configured for polling.");
        return;
      }

      console.log("Starting image polling with an interval of", imagePollInterval, "milliseconds.");

      setTimeout(pollImages, imagePollInterval);

      // Immediately call the polling function the first time
      pollImages().catch(error => {
        console.error('Image polling error:', error);
      });
    }

    // --- ALERT XML GENERATION SECTION ---

    // Alert types to filter (case-insensitive, normalized)
    const ALERT_TYPE_MAP = {
      'Tornado Warning': 'TornadoWarning',
      'Tornado Emergency': 'TornadoWarning',
      'Severe Thunderstorm Warning': 'SevereThunderstormWarning',
      'Tornado Watch': 'TornadoWatch',
      'Severe Thunderstorm Watch': 'SevereThunderstormWatch'
    };
    const ALERT_TYPE_KEYS = Object.keys(ALERT_TYPE_MAP);

    // Human-readable alert type names for XML display
    const ALERT_TYPE_DISPLAY_NAMES = {
      'TornadoWarning': 'Tornado Warning',
      'SevereThunderstormWarning': 'Severe Thunderstorm Warning',
      'TornadoWatch': 'Tornado Watch',
      'SevereThunderstormWatch': 'Severe Thunderstorm Watch'
    };

    // Utility: Emphasize "tornado warning" and "tornado" in alert text
    function emphasizeTornado(text) {
      if (!text) return text;
      // Emphasize "tornado warning" as a group, preserving original caps
      text = text.replace(/(\bTornado Warning\b)/gi, '*$1*');
      // Emphasize "tornado" not already in "*tornado warning*"
      text = text.replace(/(?<!\*)\bTornado\b(?!\s*Warning)(?!\*)/gi, '*Tornado*');
      return text;
    }

    // Utility: Fix time codes like "700 PM CDT" to "7:00 PM CDT"
    function fixTimeCodes(text) {
      if (!text) return text;
      return text.replace(/\b(\d{1,2})(\d{2})?\s*(AM|PM)\s+([A-Z]{2,4})\b/g, (_, h, m, ap, tz) => {
        m = m || "00";
        return `${parseInt(h, 10)}:${m} ${ap} ${tz}`;
      });
    }

    // Utility: Remove AWIPS identifier at start of description
    function removeAwipsIdentifier(text) {
      if (!text) return text;
      return text.replace(/^[A-Z0-9\. ]{5,}\n+/, '');
    }

    // Utility: Process alert text as in weather-announce-2.py
    function processAlertText(alert) {
      let description = alert.description || '';
      description = removeAwipsIdentifier(description);
      description = fixTimeCodes(description);
      let nwsHeadline = '';
      if (alert.parameters && alert.parameters.NWSheadline) {
        if (Array.isArray(alert.parameters.NWSheadline)) {
          nwsHeadline = alert.parameters.NWSheadline.join(' ');
        } else {
          nwsHeadline = alert.parameters.NWSheadline;
        }
        nwsHeadline = fixTimeCodes(nwsHeadline);
      }
      let headline = fixTimeCodes(alert.headline || '');
      let fullMessage = (nwsHeadline + '\n' + description).trim();
      fullMessage = emphasizeTornado(fullMessage);
      return {
        processedText: fullMessage,
        headline,
        nwsHeadline,
        description
      };
    }

    // Utility: Normalize event type to our alert type keys
    function normalizeAlertType(event, parameters) {
      if (!event) return null;
      let e = event.trim().toLowerCase();
      if (e === 'tornado emergency') return 'Tornado Emergency';
      if (e === 'tornado warning') {
        // Check for tornado emergency in parameters
        if (parameters && parameters.tornadoDamageThreat && parameters.tornadoDamageThreat[0] &&
            parameters.tornadoDamageThreat[0].toLowerCase() === 'catastrophic') {
          return 'Tornado Emergency';
        }
        return 'Tornado Warning';
      }
      if (e === 'severe thunderstorm warning') return 'Severe Thunderstorm Warning';
      if (e === 'tornado watch') return 'Tornado Watch';
      if (e === 'severe thunderstorm watch') return 'Severe Thunderstorm Watch';
      // Fuzzy match
      for (const key of ALERT_TYPE_KEYS) {
        if (e.includes(key.toLowerCase())) return key;
      }
      return null;
    }

    // Main function to fetch and write alert XMLs for each location
    async function pollAlertsForLocations() {
      if (!urlConfig || urlConfig.length === 0) return;

      const userAgent = 'github.com/brandonemlaw-nws-xml';
      for (const entry of urlConfig) {
        const { latitude, longitude, name } = entry;
        try {
          // Query alerts for this point
          const url = `https://api.weather.gov/alerts/active?point=${latitude},${longitude}`;
          const response = await fetch(url, { headers: { 'User-Agent': userAgent } });
          if (!response.ok) {
            console.error(`Failed to fetch alerts for ${name}: ${response.statusText}`);
            // Still create placeholder files even if fetch fails
            await createPlaceholderAlertFiles(name);
            continue;
          }
          const data = await response.json();
          if (!data.features || !Array.isArray(data.features)) {
            // No alerts data, create placeholders
            await createPlaceholderAlertFiles(name);
            continue;
          }

          // Find the most recent alert for each type
          const latestAlerts = {};
          for (const feature of data.features) {
            const alert = feature.properties || feature; // API sometimes nests under .properties
            if (!alert || alert.status !== "Actual" || !alert.event) continue;
            const alertType = normalizeAlertType(alert.event, alert.parameters);
            if (!alertType || !(alertType in ALERT_TYPE_MAP)) continue;
            const key = ALERT_TYPE_MAP[alertType];
            // Only keep the most recent (by sent time)
            if (!latestAlerts[key] || new Date(alert.sent) > new Date(latestAlerts[key].sent)) {
              latestAlerts[key] = alert;
            }
          }

          // Write XML for ALL alert types (active alerts or placeholders)
          for (const [alertTypeKey, alertTypeValue] of Object.entries(ALERT_TYPE_MAP)) {
            const key = alertTypeValue;
            const displayName = ALERT_TYPE_DISPLAY_NAMES[key];
            let xmlObj;
            
            if (latestAlerts[key]) {
              // Active alert found
              const alert = latestAlerts[key];
              const { processedText, headline, nwsHeadline, description } = processAlertText(alert);
              xmlObj = {
                Alert: {
                  Location: name,
                  AlertType: displayName,
                  Event: alert.event,
                  Headline: headline,
                  NWSheadline: nwsHeadline,
                  Description: description,
                  ProcessedText: processedText,
                  Instruction: alert.instruction || '',
                  Effective: alert.effective || '',
                  Expires: alert.expires || '',
                  Severity: alert.severity || '',
                  Certainty: alert.certainty || '',
                  Urgency: alert.urgency || '',
                  Status: alert.status || '',
                  MessageType: alert.messageType || '',
                  Id: alert.id || '',
                  AreaDesc: alert.areaDesc || '',
                  Web: alert.web || '',
                  Parameters: alert.parameters ? JSON.stringify(alert.parameters) : '',
                  Raw: JSON.stringify(alert)
                }
              };
            } else {
              // No active alert, create placeholder
              xmlObj = {
                Alert: {
                  Location: name,
                  AlertType: displayName,
                  Event: 'No alert in effect',
                  Headline: 'No alert in effect',
                  NWSheadline: 'No alert in effect',
                  Description: 'No alert in effect',
                  ProcessedText: 'No alert in effect',
                  Instruction: '',
                  Effective: '',
                  Expires: '',
                  Severity: '',
                  Certainty: '',
                  Urgency: '',
                  Status: '',
                  MessageType: '',
                  Id: '',
                  AreaDesc: '',
                  Web: '',
                  Parameters: '',
                  Raw: ''
                }
              };
            }
            
            const builder = new xml2js.Builder({ headless: true });
            const xml = builder.buildObject(xmlObj);

            // Sanitize file name (still using the key for consistency)
            const sanitizeFileName = (s) => s.replace(/[\/\\,:.]/g, '-').replace(/\s+/g, '_');
            const fileName = `${sanitizeFileName(name)}-${key}-Alert.xml`;
            await writeFile(fileName, xml);
          }
        } catch (err) {
          console.error(`Error processing alerts for ${name}:`, err);
          // Still create placeholder files even if there's an error
          await createPlaceholderAlertFiles(name);
        }
      }
    }

    // Helper function to create placeholder alert files when no data is available
    async function createPlaceholderAlertFiles(locationName) {
      for (const [alertTypeKey, alertTypeValue] of Object.entries(ALERT_TYPE_MAP)) {
        const key = alertTypeValue;
        const displayName = ALERT_TYPE_DISPLAY_NAMES[key];
        const xmlObj = {
          Alert: {
            Location: locationName,
            AlertType: displayName,
            Event: 'No alert in effect',
            Headline: 'No alert in effect',
            NWSheadline: 'No alert in effect',
            Description: 'No alert in effect',
            ProcessedText: 'No alert in effect',
            Instruction: '',
            Effective: '',
            Expires: '',
            Severity: '',
            Certainty: '',
            Urgency: '',
            Status: '',
            MessageType: '',
            Id: '',
            AreaDesc: '',
            Web: '',
            Parameters: '',
            Raw: ''
          }
        };
        
        const builder = new xml2js.Builder({ headless: true });
        const xml = builder.buildObject(xmlObj);

        // Sanitize file name (still using the key for consistency)
        const sanitizeFileName = (s) => s.replace(/[\/\\,:.]/g, '-').replace(/\s+/g, '_');
        const fileName = `${sanitizeFileName(locationName)}-${key}-Alert.xml`;
        await writeFile(fileName, xml);
      }
    }

    // Utility to convert a value to a string, handling null or undefined
    function toString(value) {
      return value !== null && value !== undefined ? value.toString() : '';
    }

    // Utility to convert a value to a number, handling null or undefined
    function toNumber(value) {
      const num = parseFloat(value);
      return isNaN(num) ? 0 : num;
    }

    // Utility to convert a value to a boolean, handling null or undefined
    function toBoolean(value) {
      return !!value && value !== 'false' && value !== '0';
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
      startImagePolling();
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