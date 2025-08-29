import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './styles.css';

function App() {
  const [urlConfig, setUrlConfig] = useState([]);
  const [pollInterval, setPollInterval] = useState(60);
  const [newLatitude, setNewLatitude] = useState('');
  const [newLongitude, setNewLongitude] = useState('');
  const [newName, setNewName] = useState('');
  const [imageConfig, setImageConfig] = useState([]);
  const [imagePollInterval, setImagePollInterval] = useState(1800);
  const [newImageUrl, setNewImageUrl] = useState('');
  const [newImageName, setNewImageName] = useState('');
  const [enableArkansasBurnBan, setEnableArkansasBurnBan] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [graphicNameTemplates, setGraphicNameTemplates] = useState([]);
  const [newDayNumber, setNewDayNumber] = useState('');
  const [newNameTemplate, setNewNameTemplate] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [activeTab, setActiveTab] = useState('weather');
  // Diagnostics: logging ID + status banner
  const [loggingId, setLoggingId] = useState('');
  const [loggingIdInput, setLoggingIdInput] = useState('');
  const [statusBanner, setStatusBanner] = useState({ message: '', type: 'ok', lastUpdated: null });

  // Fetch the current configuration when the component loads
  useEffect(() => {
    axios.get('/api/config')
      .then(response => {
        setUrlConfig(response.data.urlConfig);
        setPollInterval(response.data.pollInterval / 1000);
        setImageConfig(response.data.imageConfig || []);
        setImagePollInterval((response.data.imagePollInterval || 1800000) / 1000);
        setEnableArkansasBurnBan(response.data.enableArkansasBurnBan || false);
        setGraphicNameTemplates(response.data.graphicNameTemplates || []);
        // New: diagnostics state
        setLoggingId(response.data.loggingId || '');
        setLoggingIdInput(response.data.loggingId || '');
        setStatusBanner(response.data.statusBanner || { message: '', type: 'ok', lastUpdated: null });
      })
      .catch(error => console.error('Error fetching config:', error));
  }, []);

  // Poll status banner periodically (lightweight)
  useEffect(() => {
    const interval = setInterval(() => {
      axios.get('/api/status')
        .then(res => setStatusBanner(res.data))
        .catch(() => {});
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  // Helper functions for showing messages
  const showError = (message) => {
    setErrorMessage(message);
    setSuccessMessage('');
    setTimeout(() => setErrorMessage(''), 5000); // Clear after 5 seconds
  };

  const showSuccess = (message) => {
    setSuccessMessage(message);
    setErrorMessage('');
    setTimeout(() => setSuccessMessage(''), 3000); // Clear after 3 seconds
  };

  // Handle manual refresh
  const handleRefresh = (e) => {
    e.preventDefault();
    showSuccess('Refreshing weather data...');
    axios.post('/api/refresh', {})
      .then(() => showSuccess('Weather data refresh initiated'))
      .catch(error => {
        console.error('Error refreshing data:', error);
        showError('Failed to refresh weather data. Please check your connection.');
      });
  };

  // Handle adding a new location
  const handleSubmit = (e) => {
    e.preventDefault();
    
    // Basic validation
    if (!newLatitude || !newLongitude || !newName) {
      showError('Please fill in all fields');
      return;
    }
    
    const lat = parseFloat(newLatitude);
    const lng = parseFloat(newLongitude);
    
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      showError('Please enter valid latitude (-90 to 90) and longitude (-180 to 180) values');
      return;
    }
    
    axios.post('/api/config', {
      latitude: newLatitude,
      longitude: newLongitude,
      name: newName,
      pollInterval: pollInterval * 1000
    })
    .then(response => {
      setUrlConfig(response.data.urlConfig);
      setNewLatitude('');
      setNewLongitude('');
      setNewName('');
      showSuccess(`Location "${newName}" added successfully`);
    })
    .catch(error => {
      console.error('Error updating config:', error);
      showError('Failed to add location. Please check your input and try again.');
    });
  };

  // Handle setting the refresh interval
  const handleSetRefresh = (e) => {
    e.preventDefault();
    axios.post('/api/setRefresh', {
      pollInterval: pollInterval * 1000
    })
    .then(response => {
      setUrlConfig(response.data.urlConfig);
    })
    .catch(error => console.error('Error updating refresh interval:', error));
  };

  // Handle deleting a location configuration
  const handleDelete = (name) => {
    axios.delete('/api/config', { data: { name } })
      .then(response => {
        setUrlConfig(response.data.urlConfig);
      })
      .catch(error => console.error('Error deleting location:', error));
  };

  // Handle manual image refresh
  const handleImageRefresh = (e) => {
    e.preventDefault();
    axios.post('/api/refreshImages', {})
      .catch(error => console.error('Error refreshing images:', error));
  };

  // Handle adding a new image
  const handleImageSubmit = (e) => {
    e.preventDefault();
    axios.post('/api/imageConfig', {
      url: newImageUrl,
      name: newImageName
    })
    .then(response => {
      setImageConfig(response.data.imageConfig);
      setNewImageUrl('');
      setNewImageName('');
    })
    .catch(error => console.error('Error updating image config:', error));
  };

  // Handle setting the image refresh interval
  const handleSetImageRefresh = (e) => {
    e.preventDefault();
    axios.post('/api/setImageRefresh', {
      imagePollInterval: imagePollInterval * 1000
    })
    .then(response => {
      setImageConfig(response.data.imageConfig);
    })
    .catch(error => console.error('Error updating image refresh interval:', error));
  };

  // Handle deleting an image configuration
  const handleImageDelete = (name) => {
    axios.delete('/api/imageConfig', { data: { name } })
      .then(response => {
        setImageConfig(response.data.imageConfig);
      })
      .catch(error => console.error('Error deleting image:', error));
  };

  // Handle Arkansas burn ban toggle
  const handleArkansasBurnBanToggle = (e) => {
    const enabled = e.target.checked;
    setEnableArkansasBurnBan(enabled);
    axios.post('/api/arkansasBurnBan', { enabled })
      .then(response => {
        showSuccess(`Arkansas burn ban ${enabled ? 'enabled' : 'disabled'}`);
        console.log('Arkansas burn ban setting updated');
      })
      .catch(error => {
        console.error('Error updating Arkansas burn ban setting:', error);
        setEnableArkansasBurnBan(!enabled); // Revert the checkbox
        showError('Failed to update Arkansas burn ban setting');
      });
  };

  // Handle adding a new graphic name template
  const handleGraphicNameSubmit = (e) => {
    e.preventDefault();
    
    // Validation
    if (!newDayNumber || !newNameTemplate) {
      showError('Please fill in both day number and name template');
      return;
    }
    
    const dayNum = parseInt(newDayNumber);
    if (isNaN(dayNum) || dayNum < 0 || dayNum > 14) {
      showError('Day number must be between 0 and 14');
      return;
    }
    
    if (newNameTemplate.trim().length === 0) {
      showError('Name template cannot be empty');
      return;
    }
    
    axios.post('/api/graphicNameTemplates', {
      dayNumber: dayNum,
      nameTemplate: newNameTemplate.trim()
    })
    .then(response => {
      setGraphicNameTemplates(response.data.graphicNameTemplates);
      setNewDayNumber('');
      setNewNameTemplate('');
      showSuccess('Graphic name template added successfully');
    })
    .catch(error => {
      console.error('Error adding graphic name template:', error);
      showError('Failed to add graphic name template');
    });
  };

  // Handle deleting a graphic name template
  const handleGraphicNameDelete = (index) => {
    axios.delete('/api/graphicNameTemplates', { data: { index } })
      .then(response => {
        setGraphicNameTemplates(response.data.graphicNameTemplates);
        showSuccess('Graphic name template deleted');
      })
      .catch(error => {
        console.error('Error deleting graphic name template:', error);
        showError('Failed to delete graphic name template');
      });
  };

  // Handle configuration export
  const handleExportConfig = () => {
    axios.get('/api/exportConfig', { responseType: 'blob' })
      .then(response => {
        // Create blob link to download the file
        const url = window.URL.createObjectURL(new Blob([response.data]));
        const link = document.createElement('a');
        link.href = url;
        
        // Generate filename with current date
        const date = new Date().toISOString().split('T')[0];
        link.setAttribute('download', `nws-xml-config-${date}.json`);
        
        // Append to body and click
        document.body.appendChild(link);
        link.click();
        
        // Clean up
        link.remove();
        window.URL.revokeObjectURL(url);
        
        showSuccess('Configuration exported successfully');
      })
      .catch(error => {
        console.error('Error exporting configuration:', error);
        showError('Failed to export configuration');
      });
  };

  // Handle configuration import
  const handleImportConfig = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    
    if (!file.name.endsWith('.json')) {
      showError('Please select a JSON configuration file');
      return;
    }
    
    setIsImporting(true);
    
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const configData = JSON.parse(e.target.result);
        
        axios.post('/api/importConfig', configData)
          .then(response => {
            const imported = response.data.importedData;
            
            // Refresh the UI with new data
            axios.get('/api/config')
              .then(configResponse => {
                setUrlConfig(configResponse.data.urlConfig);
                setPollInterval(configResponse.data.pollInterval / 1000);
                setImageConfig(configResponse.data.imageConfig || []);
                setImagePollInterval((configResponse.data.imagePollInterval || 1800000) / 1000);
                setEnableArkansasBurnBan(configResponse.data.enableArkansasBurnBan || false);
                setGraphicNameTemplates(configResponse.data.graphicNameTemplates || []);
                
                showSuccess(`Configuration imported: ${imported.locations} locations, ${imported.images} images, ${imported.graphicTemplates} graphic templates`);
              });
          })
          .catch(error => {
            console.error('Error importing configuration:', error);
            const errorMsg = error.response?.data?.error || 'Failed to import configuration';
            showError(errorMsg);
          })
          .finally(() => {
            setIsImporting(false);
            // Reset the file input
            event.target.value = '';
          });
          
      } catch (parseError) {
        console.error('Error parsing configuration file:', parseError);
        showError('Invalid JSON file format');
        setIsImporting(false);
        event.target.value = '';
      }
    };
    
    reader.readAsText(file);
  };

  // Diagnostics: save/clear logging ID
  const handleSaveLoggingId = (e) => {
    e.preventDefault();
    axios.post('/api/logging', { loggingId: loggingIdInput })
      .then(res => {
        setLoggingId(res.data.loggingId || '');
        setLoggingIdInput(res.data.loggingId || '');
        showSuccess('Logging ID saved');
      })
      .catch(err => {
        console.error('Error saving logging ID:', err);
        showError('Failed to save Logging ID');
      });
  };

  const handleClearLoggingId = () => {
    axios.delete('/api/logging')
      .then(() => {
        setLoggingId('');
        setLoggingIdInput('');
        showSuccess('Logging ID cleared');
      })
      .catch(err => {
        console.error('Error clearing logging ID:', err);
        showError('Failed to clear Logging ID');
      });
  };

  return (
    <div className="container">
      {/* Status Banner (shows only on error) */}
      {statusBanner?.type === 'error' && statusBanner?.message ? (
        <div style={{
          backgroundColor: '#fff3e0',
          color: '#e65100',
          padding: '10px',
          borderRadius: '4px',
          marginBottom: '15px',
          border: '1px solid #ffe0b2'
        }}>
          ⚠️ {statusBanner.message}
        </div>
      ) : null}

      {/* Error and Success Messages */}
      {errorMessage && (
        <div style={{
          backgroundColor: '#ffebee',
          color: '#c62828',
          padding: '10px',
          borderRadius: '4px',
          marginBottom: '15px',
          border: '1px solid #ffcdd2'
        }}>
          {errorMessage}
        </div>
      )}
      {successMessage && (
        <div style={{
          backgroundColor: '#e8f5e8',
          color: '#2e7d32',
          padding: '10px',
          borderRadius: '4px',
          marginBottom: '15px',
          border: '1px solid #c8e6c9'
        }}>
          {successMessage}
        </div>
      )}

      {/* Tab Navigation */}
      <div className="tabs">
        <button 
          className={`tab ${activeTab === 'weather' ? 'active' : ''}`}
          onClick={() => setActiveTab('weather')}
        >
          ⛅ Weather Locations
        </button>
        <button 
          className={`tab ${activeTab === 'images' ? 'active' : ''}`}
          onClick={() => setActiveTab('images')}
        >
          🖼️ Images
        </button>
        <button 
          className={`tab ${activeTab === 'graphics' ? 'active' : ''}`}
          onClick={() => setActiveTab('graphics')}
        >
          📊 Graphic Names
        </button>
        <button 
          className={`tab ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => setActiveTab('settings')}
        >
          ⚙️ Settings
        </button>
      </div>

      {/* Tab Content */}
      <div className="tab-content">
        {activeTab === 'weather' && (
          <div>
            <h2>Weather Locations</h2>
            
            {/* Manual refresh button */}
            <div style={{ marginBottom: '20px' }}>
              <button onClick={handleRefresh} style={{ marginRight: '10px' }}>
                🔄 Refresh Weather Data
              </button>
            </div>

            {/* List of configured locations */}
            <h3>Configured Locations</h3>
            {urlConfig.length > 0 ? (
              <ul>
                {urlConfig.map((entry, index) => (
                  <li key={index} style={{ marginBottom: '15px', padding: '10px', border: '1px solid #ddd', borderRadius: '4px' }}>
                    <strong>Name:</strong> {entry.name} <br />
                    <strong>Latitude:</strong> {entry.latitude} <br />
                    <strong>Longitude:</strong> {entry.longitude} <br />
                    <button 
                      onClick={() => handleDelete(entry.name)}
                      style={{ marginTop: '5px', backgroundColor: '#d32f2f', color: 'white', border: 'none', padding: '5px 10px', borderRadius: '4px' }}
                    >
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p style={{ color: '#666', fontStyle: 'italic' }}>No weather locations configured</p>
            )}

            {/* Form to configure a new location */}
            <h3>Add New Location</h3>
            <form onSubmit={handleSubmit}>
              <div style={{ marginBottom: '10px' }}>
                <label>
                  Latitude:
                  <input
                    type="number"
                    step="any"
                    value={newLatitude}
                    onChange={(e) => setNewLatitude(e.target.value)}
                    required
                    style={{ marginLeft: '10px' }}
                  />
                </label>
              </div>
              <div style={{ marginBottom: '10px' }}>
                <label>
                  Longitude:
                  <input
                    type="number"
                    step="any"
                    value={newLongitude}
                    onChange={(e) => setNewLongitude(e.target.value)}
                    required
                    style={{ marginLeft: '10px' }}
                  />
                </label>
              </div>
              <div style={{ marginBottom: '10px' }}>
                <label>
                  Name:
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    required
                    style={{ marginLeft: '10px' }}
                  />
                </label>
              </div>
              <button type="submit">Add Location</button>
            </form>

            {/* Form to change the refresh interval */}
            <h3>Weather Refresh Interval</h3>
            <form onSubmit={handleSetRefresh}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <label>
                  Refresh Time (seconds):
                  <input
                    type="number"
                    value={pollInterval}
                    onChange={(e) => setPollInterval(e.target.value)}
                    required
                    style={{ marginLeft: '10px' }}
                  />
                </label>
                <button type="submit">Save</button>
              </div>
            </form>
          </div>
        )}

        {activeTab === 'images' && (
          <div>
            <h2>Image Sources</h2>
            
            {/* Manual image refresh button */}
            <div style={{ marginBottom: '20px' }}>
              <button onClick={handleImageRefresh}>
                🔄 Refresh Images
              </button>
            </div>

            {/* List of configured images */}
            <h3>Configured Images</h3>
            {imageConfig.length > 0 ? (
              <ul>
                {imageConfig.map((entry, index) => (
                  <li key={index} style={{ marginBottom: '15px', padding: '10px', border: '1px solid #ddd', borderRadius: '4px' }}>
                    <strong>Name:</strong> {entry.name} <br />
                    <strong>URL:</strong> {entry.url} <br />
                    <button 
                      onClick={() => handleImageDelete(entry.name)}
                      style={{ marginTop: '5px', backgroundColor: '#d32f2f', color: 'white', border: 'none', padding: '5px 10px', borderRadius: '4px' }}
                    >
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p style={{ color: '#666', fontStyle: 'italic' }}>No image sources configured</p>
            )}

            {/* Form to configure a new image */}
            <h3>Add New Image Source</h3>
            <form onSubmit={handleImageSubmit}>
              <div style={{ marginBottom: '10px' }}>
                <label>
                  Image URL:
                  <input
                    type="url"
                    value={newImageUrl}
                    onChange={(e) => setNewImageUrl(e.target.value)}
                    required
                    style={{ marginLeft: '10px', width: '300px' }}
                  />
                </label>
              </div>
              <div style={{ marginBottom: '10px' }}>
                <label>
                  Image Name:
                  <input
                    type="text"
                    value={newImageName}
                    onChange={(e) => setNewImageName(e.target.value)}
                    required
                    style={{ marginLeft: '10px' }}
                  />
                </label>
              </div>
              <button type="submit">Add Image</button>
            </form>

            {/* Form to change the image refresh interval */}
            <h3>Image Refresh Interval</h3>
            <form onSubmit={handleSetImageRefresh}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <label>
                  Image Refresh Time (seconds):
                  <input
                    type="number"
                    value={imagePollInterval}
                    onChange={(e) => setImagePollInterval(e.target.value)}
                    required
                    style={{ marginLeft: '10px' }}
                  />
                </label>
                <button type="submit">Save</button>
              </div>
            </form>
          </div>
        )}

        {activeTab === 'graphics' && (
          <div>
            <h2>Graphic Name Generator</h2>
            <p style={{ fontSize: '14px', color: '#666', marginBottom: '15px' }}>
              Create templates for graphic names using day numbers. Use {'{day}'} as a placeholder for the day name.
              <br />
              <strong>Example:</strong> Day "3" + "'s Tornado Risk" becomes "Thursday's Tornado Risk" (if today is Tuesday)
            </p>

            {/* List of configured graphic name templates */}
            <h3>Current Templates</h3>
            {graphicNameTemplates.length > 0 ? (
              <ul>
                {graphicNameTemplates.map((template, index) => {
                  const today = new Date();
                  const targetDate = new Date(today);
                  targetDate.setDate(today.getDate() + template.dayNumber);
                  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                  const dayName = dayNames[targetDate.getDay()];
                  const preview = template.nameTemplate.replace(/\{day\}/g, dayName);
                  
                  return (
                    <li key={index} style={{ marginBottom: '15px', padding: '10px', border: '1px solid #ddd', borderRadius: '4px' }}>
                      <strong>Day {template.dayNumber}:</strong> {template.nameTemplate}<br />
                      <span style={{ fontSize: '12px', color: '#666', fontStyle: 'italic' }}>
                        Preview: "{preview}"
                      </span><br />
                      <button 
                        onClick={() => handleGraphicNameDelete(index)}
                        style={{ marginTop: '5px', backgroundColor: '#d32f2f', color: 'white', border: 'none', padding: '5px 10px', borderRadius: '4px' }}
                      >
                        Delete
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p style={{ color: '#666', fontStyle: 'italic' }}>No graphic name templates configured</p>
            )}

            {/* Form to add new graphic name template */}
            <h3>Add New Template</h3>
            <form onSubmit={handleGraphicNameSubmit}>
              <div style={{ marginBottom: '10px' }}>
                <label>
                  Day Number (0 = today, 1 = tomorrow, etc.):
                  <input
                    type="number"
                    min="0"
                    max="14"
                    value={newDayNumber}
                    onChange={(e) => setNewDayNumber(e.target.value)}
                    placeholder="e.g., 3"
                    required
                    style={{ marginLeft: '10px' }}
                  />
                </label>
              </div>
              <div style={{ marginBottom: '10px' }}>
                <label>
                  Name Template (use {'{day}'} for day name):
                  <input
                    type="text"
                    value={newNameTemplate}
                    onChange={(e) => setNewNameTemplate(e.target.value)}
                    placeholder="e.g., {day}'s Tornado Risk"
                    required
                    style={{ marginLeft: '10px', width: '250px' }}
                  />
                </label>
              </div>
              <button type="submit">Add Template</button>
            </form>
          </div>
        )}

        {activeTab === 'settings' && (
          <div>
            <h2>Settings & Configuration</h2>

            {/* Diagnostics & Logging */}
            <h3>Diagnostics & Logging</h3>
            <div style={{ marginBottom: '20px' }}>
              <form onSubmit={handleSaveLoggingId} style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                <label>
                  Logging ID:
                  <input
                    type="text"
                    value={loggingIdInput}
                    onChange={(e) => setLoggingIdInput(e.target.value)}
                    placeholder="Enter ID"
                    style={{ marginLeft: '10px', width: '260px' }}
                  />
                </label>
                <button type="submit">Save</button>
                <button type="button" onClick={handleClearLoggingId} style={{ backgroundColor: '#d32f2f', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '4px' }}>
                  Clear
                </button>
              </form>
              {loggingId ? (
                <p style={{ fontSize: '12px', color: '#666', marginTop: '6px' }}>
                  Active ID: <code>{loggingId}</code>
                </p>
              ) : (
                <p style={{ fontSize: '12px', color: '#666', marginTop: '6px' }}>
                  No Logging ID set. Diagnostics will be disabled.
                </p>
              )}
            </div>

            {/* Arkansas Burn Ban checkbox */}
            <h3>Special Features</h3>
            <div style={{ marginBottom: '30px' }}>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={enableArkansasBurnBan}
                  onChange={handleArkansasBurnBanToggle}
                />
                Enable Arkansas Burn Ban Map
              </label>
              <p style={{ fontSize: '12px', color: '#666', marginTop: '5px' }}>
                Automatically captures and saves the Arkansas burn ban map image every refresh cycle.
              </p>
            </div>

            {/* Configuration Import/Export Section */}
            <h3>Configuration Management</h3>
            <p style={{ fontSize: '14px', color: '#666', marginBottom: '15px' }}>
              Export your current configuration to a file or import a configuration from another computer to keep settings in sync.
            </p>
            
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '15px' }}>
              <button 
                onClick={handleExportConfig}
                style={{ 
                  backgroundColor: '#2e7d32', 
                  color: 'white',
                  padding: '8px 16px',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                📥 Export Configuration
              </button>
              
              <label style={{ 
                backgroundColor: '#1976d2', 
                color: 'white',
                padding: '8px 16px',
                borderRadius: '4px',
                cursor: 'pointer',
                display: 'inline-block'
              }}>
                📤 Import Configuration
                <input
                  type="file"
                  accept=".json"
                  onChange={handleImportConfig}
                  style={{ display: 'none' }}
                  disabled={isImporting}
                />
              </label>
              
              {isImporting && (
                <span style={{ color: '#666', fontSize: '14px' }}>
                  Importing configuration...
                </span>
              )}
            </div>
            
            <div style={{ 
              backgroundColor: '#f5f5f5', 
              padding: '10px', 
              borderRadius: '4px', 
              fontSize: '12px',
              color: '#666'
            }}>
              <strong>Note:</strong> Importing a configuration will replace all current settings including:
              <ul style={{ margin: '5px 0', paddingLeft: '20px' }}>
                <li>Weather locations and refresh intervals</li>
                <li>Image sources and polling settings</li>
                <li>Graphic name templates</li>
                <li>Arkansas burn ban setting</li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;