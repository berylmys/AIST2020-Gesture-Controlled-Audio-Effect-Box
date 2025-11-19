import React, { useState } from 'react';
import './App.css';

function App() {
  const [videoFile, setVideoFile] = useState(null);
  const [videoFilename, setVideoFilename] = useState('');
  const [uploading, setUploading] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [message, setMessage] = useState('');
  const [sceneData, setSceneData] = useState(null);
  const [numActivityTypes, setNumActivityTypes] = useState(3);
  const [sensitivity, setSensitivity] = useState(1.0);

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploading(true);
    setMessage('Uploading video...');

    const formData = new FormData();
    formData.append('video', file);

    try {
      const response = await fetch('http://localhost:5001/api/upload-video', {
        method: 'POST',
        body: formData
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      
      setVideoFilename(data.filename);
      setVideoFile(file);
      setMessage('Video uploaded successfully! 🎉');
      setSceneData(null);
    } catch (error) {
      console.error('Upload error:', error);
      setMessage('Upload failed: ' + error.message);
    } finally {
      setUploading(false);
    }
  };

  const handleDetect = async () => {
    if (!videoFilename) {
      setMessage('Please upload a video first');
      return;
    }

    setDetecting(true);
    setMessage('Analyzing video and detecting scenes...');

    try {
      const response = await fetch('http://localhost:5001/api/detect-scenes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          filename: videoFilename,
          scenes: numActivityTypes,
          sensitivity: sensitivity
        })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      await response.json();
      
      const scenesResponse = await fetch('http://localhost:5001/api/get-scenes', {
        cache: 'no-cache'
      });
      const scenesData = await scenesResponse.json();
      
      setSceneData(scenesData);
      console.log('Received scene data:', scenesData);
      console.log('Number of activity types:', scenesData.num_activity_types);
      setMessage('Scene detection complete! ✨');
    } catch (error) {
      console.error('Detection error:', error);
      setMessage('Detection failed: ' + error.message);
    } finally {
      setDetecting(false);
    }
  };

  const downloadJSON = () => {
    if (!sceneData) return;
    
    const dataStr = JSON.stringify(sceneData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'scenes.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  const sendToHardware = () => {
    alert('🔧 Preparing to send to hardware device...\n\n(This feature will be implemented during hardware integration)');
    console.log('Scene data to send:', sceneData);
  };

  return (
    <div className="App">
      <header>
        <h1>🎵 Foley from Junk</h1>
        <p>Automatic Scene Detection - Generate Control Data for Hardware Sound System</p>
      </header>

      <main>
        <div className="section upload-section">
          <h2>Upload Video</h2>
          <label className="file-upload-wrapper" htmlFor="video-upload">
            <span className="file-upload-label">
              {videoFile ? videoFile.name : 'Choose a video file'}
            </span>
            <span className="file-upload-hint">
              {videoFile ? 'Click to change file' : 'Supports MP4, AVI, MOV, MKV, and more'}
            </span>
          </label>
          <input 
            id="video-upload"
            type="file" 
            accept="video/*" 
            onChange={handleUpload}
            disabled={uploading}
          />
          {uploading && <p className="status">Uploading your video...</p>}
        </div>

        {videoFile && (
          <div className="section video-section">
            <h2>Video Preview</h2>
            <video 
              controls 
              width="600"
              src={URL.createObjectURL(videoFile)}
            />
          </div>
        )}

        {videoFilename && (
          <div className="section detect-section">
            <h2>Detect Scenes</h2>
            
            <div style={{ marginBottom: '25px', minHeight: '120px' }}>
              <label style={{ display: 'block', marginBottom: '18px', fontSize: '15px' }}>
                <strong style={{ color: '#00d9ff' }}>Number of Activity Types:</strong>
                <input 
                  type="number" 
                  min="1" 
                  max="10" 
                  value={numActivityTypes}
                  onChange={(e) => {
                    const val = parseInt(e.target.value);
                    if (!isNaN(val) && val >= 1 && val <= 10) {
                      setNumActivityTypes(val);
                    }
                  }}
                  onBlur={(e) => {
                    const val = parseInt(e.target.value);
                    if (isNaN(val) || val < 1) {
                      setNumActivityTypes(1);
                    } else if (val > 10) {
                      setNumActivityTypes(10);
                    }
                  }}
                  style={{ 
                    marginLeft: '12px', 
                    padding: '10px 12px', 
                    width: '70px', 
                    borderRadius: '8px', 
                    border: '2px solid rgba(0, 217, 255, 0.3)',
                    backgroundColor: 'rgba(0, 217, 255, 0.05)',
                    color: '#00d9ff',
                    fontSize: '15px',
                    fontWeight: '600'
                  }}
                />
                <span style={{ marginLeft: '12px', fontSize: '13px', color: '#b0b8d4' }}>
                  (How many types of activities to group scenes into)
                </span>
              </label>
              
              <label style={{ display: 'block', marginBottom: '18px', fontSize: '15px' }}>
                <strong style={{ color: '#00d9ff' }}>Sensitivity:</strong>
                <input 
                  type="number" 
                  min="0.1" 
                  max="3.0" 
                  step="0.1"
                  value={sensitivity}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    if (!isNaN(val) && val >= 0.1 && val <= 3.0) {
                      setSensitivity(Math.round(val * 10) / 10);
                    }
                  }}
                  onBlur={(e) => {
                    let val = parseFloat(e.target.value);
                    if (isNaN(val) || val < 0.1) {
                      setSensitivity(0.1);
                    } else if (val > 3.0) {
                      setSensitivity(3.0);
                    } else {
                      setSensitivity(Math.round(val * 10) / 10);
                    }
                  }}
                  style={{ 
                    marginLeft: '12px', 
                    padding: '10px 12px', 
                    width: '70px', 
                    borderRadius: '8px', 
                    border: '2px solid rgba(0, 217, 255, 0.3)',
                    backgroundColor: 'rgba(0, 217, 255, 0.05)',
                    color: '#00d9ff',
                    fontSize: '15px',
                    fontWeight: '600'
                  }}
                />
                <span style={{ marginLeft: '12px', fontSize: '13px', color: '#b0b8d4' }}>
                  (Lower = more scene changes detected, e.g. 0.3 for high sensitivity)
                </span>
              </label>
            </div>
            
            <button 
              onClick={handleDetect}
              disabled={detecting}
              className="btn-primary"
            >
              {detecting ? (
                <>
                  Analyzing...
                  <span className="loading-spinner"></span>
                </>
              ) : (
                'Start Detection'
              )}
            </button>
          </div>
        )}

        {message && (
          <div className={`message ${message.includes('failed') || message.includes('Failed') ? 'error' : 'success'}`}>
            {message}
          </div>
        )}

        {sceneData && (
          <div className="section results-section">
            <h2>Detection Results</h2>
            
            <div className="result-summary">
              <div className="summary-card">
                <span className="label">Video Duration</span>
                <span className="value">{sceneData.total_duration?.toFixed(1)}s</span>
              </div>
              <div className="summary-card">
                <span className="label">Activity Types</span>
                <span className="value">{sceneData.num_activity_types}</span>
              </div>
              <div className="summary-card">
                <span className="label">Scene Segments</span>
                <span className="value">{sceneData.total_scenes}</span>
              </div>
            </div>

            <div className="activity-groups">
              {Object.entries(sceneData.activity_groups || {}).map(([groupId, group]) => (
                <div key={groupId} className="activity-group">
                  <h3>Activity Type {parseInt(groupId) + 1}: {group.description}</h3>
                  <p className="group-info">Appears {group.count} time{group.count > 1 ? 's' : ''}</p>
                  
                  <div className="scenes-list">
                    {group.scenes.map((scene, idx) => (
                      <div key={idx} className="scene-item">
                        <span className="scene-time">
                          {scene.start_formatted} - {scene.end_formatted}
                        </span>
                        <span className="scene-duration">
                          {scene.duration.toFixed(1)}s
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="action-buttons">
              <button onClick={downloadJSON} className="btn-download">
                📥 Download JSON Data
              </button>
              <button onClick={sendToHardware} className="btn-hardware">
                🔌 Send to Hardware
              </button>
            </div>

            <details className="json-preview">
              <summary>View Complete JSON Data</summary>
              <pre>{JSON.stringify(sceneData, null, 2)}</pre>
            </details>
          </div>
        )}
      </main>

      <footer>
        <p>💡 The generated JSON data will be used to control hardware devices to trigger sound effects</p>
      </footer>
    </div>
  );
}

export default App;