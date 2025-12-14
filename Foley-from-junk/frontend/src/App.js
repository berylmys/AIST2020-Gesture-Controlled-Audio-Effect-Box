import React, { useState, useRef, useEffect } from 'react';
import './App.css';

function App() {
  const [file, setFile] = useState(null);
  const [filename, setFilename] = useState('');
  const [fileType, setFileType] = useState('');
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisData, setAnalysisData] = useState(null);
  const [message, setMessage] = useState('');
  const [currentTime, setCurrentTime] = useState(0);
  const [playingSlice, setPlayingSlice] = useState(null);
  const [selectedSlice, setSelectedSlice] = useState(null);
  const [foleyLibrary, setFoleyLibrary] = useState([]);
  const [foleyUploading, setFoleyUploading] = useState(false);
  const [selectedFoleyForSlice, setSelectedFoleyForSlice] = useState('');
  const [mappings, setMappings] = useState([]);
  const [composedUrl, setComposedUrl] = useState(null);
  const [composing, setComposing] = useState(false);
  const [composeHistory, setComposeHistory] = useState([]);
  const [mediaUrl, setMediaUrl] = useState(null);
  const composedAudioRef = useRef(null);
  const previousComposedRef = useRef(null);
  const playingVideoComposedRef = useRef(false);
  
  // Analysis parameters
  const [method, setMethod] = useState('onset');
  const [minDuration, setMinDuration] = useState(0.02);
  const [topDb, setTopDb] = useState(30);
  
  // Foley 音效增强参数
  const [foleyEnhance, setFoleyEnhance] = useState(true);  // 默认启用
  
  const audioRef = useRef(null);
  const waveformRef = useRef(null);
  const videoRef = useRef(null);
  const previewAudioRef = useRef(null);

  // File upload handler
  const handleFileUpload = async (e) => {
    const uploadedFile = e.target.files[0];
    if (!uploadedFile) return;

    setUploading(true);
    setMessage('📤 Uploading...');

    const formData = new FormData();
    formData.append('file', uploadedFile);

    try {
      const response = await fetch('http://localhost:5001/api/upload', {
        method: 'POST',
        body: formData
      });
      
      const data = await response.json();
      setFilename(data.filename);
      setFileType(data.file_type);
      setFile(uploadedFile);
      setMessage(`✅ ${data.file_type === 'video' ? 'Video' : 'Audio'} uploaded successfully!`);
      setAnalysisData(null);
      setMappings([]);
      setComposedUrl(null);
      setSelectedSlice(null);
    } catch (error) {
      setMessage('❌ Upload failed: ' + error.message);
    } finally {
      setUploading(false);
    }
  };

  // Analysis handler
  const handleAnalyze = async () => {
    if (!filename) return;

    setAnalyzing(true);
    setMessage('🔍 Analyzing audio and detecting slices...');

    try {
      const response = await fetch('http://localhost:5001/api/analyze-and-slice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename,
          method,
          min_duration: minDuration,
          top_db: topDb
        })
      });
      
      const data = await response.json();
      
      if (data.success) {
        // Build cluster map from clusters data
        const clusterMap = {};
        if (data.clusters) {
          data.clusters.forEach(cluster => {
            cluster.members.forEach(memberIndex => {
              clusterMap[memberIndex] = cluster.cluster_id;
            });
          });
        }
        
        // Validate and fix data, ensure all necessary fields exist
        const validatedSlices = data.slices.map((slice, idx) => ({
          ...slice,
          features: {
            duration: slice.features?.duration || 0,
            rms: slice.features?.rms || 0,
            spectral_centroid: slice.features?.spectral_centroid || 0,
            onset_strength: slice.features?.onset_strength || 0,
            start_time: slice.features?.start_time || 0,
            end_time: slice.features?.end_time || 0,
            type: slice.features?.type || 'unknown',
            type_label: slice.features?.type_label || 'Unknown',
            zcr: slice.features?.zcr || 0,
            spec_cent: slice.features?.spec_cent || 0,
            spec_bw: slice.features?.spec_bw || 0,
            ...slice.features
          },
          cluster: clusterMap[idx] ?? slice.cluster ?? 0
        }));
        
        setAnalysisData({
          ...data,
          slices: validatedSlices,
          num_slices: data.stats?.total_slices || validatedSlices.length,
          num_clusters: data.clusters?.length || 1,
          duration: data.stats?.duration || 0
        });
        setMessage(`✨ Found ${validatedSlices.length} sound events in ${data.clusters?.length || 1} categories!`);
      } else {
        setMessage(`❌ ${data.error}. ${data.suggestion || ''}`);
      }
    } catch (error) {
      setMessage('❌ Analysis failed: ' + error.message);
    } finally {
      setAnalyzing(false);
    }
  };

  // Stop preview audio
  const stopPreview = () => {
    try {
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
        if (previewAudioRef.current.src) {
          URL.revokeObjectURL(previewAudioRef.current.src);
        }
        previewAudioRef.current = null;
      }
      if (videoRef.current) videoRef.current.muted = false;
      if (audioRef.current) audioRef.current.muted = false;
    } catch (e) {
      console.error('Error stopping preview:', e);
    }
  };

  // Preview slice with foley mapping support
  const previewSlice = async (slice, options = { seekOnly: false }) => {
    stopPreview();
    try {
      const start = slice.features.start_time;
      const sliceIndex = analysisData ? analysisData.slices.indexOf(slice) : -1;
      const mapping = mappings.find(m => m.slice_index === sliceIndex);

      // Seek and play main media (video or audio)
      if (file && fileType === 'video' && videoRef.current) {
        const v = videoRef.current;
        v.currentTime = start;
        // Mute video audio if foley mapping exists
        if (mapping && mapping.foley_filename) {
          v.muted = true;
        } else {
          v.muted = false;
        }
        if (!options.seekOnly) {
          v.play();
        }
      } else if (file && fileType !== 'video' && audioRef.current) {
        const a = audioRef.current;
        a.currentTime = start;
        if (mapping && mapping.foley_filename) {
          a.muted = true;
        } else {
          a.muted = false;
        }
        if (!options.seekOnly) {
          a.play();
        }
      }

      // If there's a mapping and not seekOnly, play the mapped foley slice
      if (mapping && mapping.foley_filename && !options.seekOnly) {
        const fn = mapping.foley_filename;
        const r = await fetch(`http://localhost:5001/api/get-foley/${fn}`);
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        const pa = new Audio(url);
        previewAudioRef.current = pa;
        pa.volume = mapping.gain || 1.0;
        pa.play();
        setPlayingSlice(slice);
        pa.onended = () => {
          setPlayingSlice(null);
          stopPreview();
        };
      } else {
        // No mapping: just play main media
        setPlayingSlice(slice);
      }
    } catch (err) {
      console.error('Preview failed:', err);
      setMessage('❌ Preview failed: ' + err.message);
      stopPreview();
    }
  };

  // Get cluster color (legacy - for backward compatibility)
  const getClusterColor = (cluster) => {
    const colors = [
      '#00d9ff', '#ff00ff', '#00ff88', '#ffcc00',
      '#ff3d71', '#764ba2', '#667eea', '#f093fb'
    ];
    return colors[cluster % colors.length];
  };

  // Get sound type color - 8 distinct colors for 8 sound categories
  const getSoundTypeColor = (type) => {
    const typeColors = {
      'impact': '#FF6B6B',      // red - impact
      'metallic': '#4ECDC4',    // cyan - metallic
      'friction': '#95E1D3',    // mint - friction
      'liquid': '#38A3A5',      // aqua - liquid
      'burst': '#F38181',       // magenta - burst
      'resonant': '#AA96DA',    // purple - resonant
      'ambient': '#FCBAD3',     // pink - ambient
      'continuous': '#FFFFD2'   // yellow - continuous 
    };
    return typeColors[type] || '#808080'; // 默认灰色
  };

  // Get sound type label with emoji
  const getSoundTypeLabel = (type) => {
    const labels = {
      'impact': '🥁 Impact',
      'metallic': '🔔 Metallic',
      'friction': '✋ Friction',
      'liquid': '💧 Liquid',
      'burst': '💥 Burst',
      'resonant': '🎵 Resonant',
      'ambient': '🌊 Ambient',
      'continuous': '➰ Continuous'
    };
    return labels[type] || type;
  };

  // Format time as M:SS.SSS
  const formatTime = (sec) => {
    const m = Math.floor(sec / 60);
    const s = (sec % 60).toFixed(3);
    return `${m}:${s.padStart(6, '0')}`;
  };

  // Download analysis as JSON
  const downloadJSON = () => {
    if (!analysisData) return;
    const dataStr = JSON.stringify(analysisData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${filename}_analysis.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Create media URL from uploaded file
  useEffect(() => {
    if (file) {
      const url = URL.createObjectURL(file);
      setMediaUrl(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [file]);

  // Fetch foley library from server
  const fetchFoleyLibrary = async () => {
    try {
      const r = await fetch('http://localhost:5001/api/foley-library');
      const data = await r.json();
      setFoleyLibrary(data.library || []);
    } catch (err) {
      console.error('Failed to fetch foley library:', err);
    }
  };

  // Load foley library on mount
  useEffect(() => {
    fetchFoleyLibrary();
  }, []);

  // Upload foley file
  const handleFoleyUpload = async (e) => {
    const foleyFile = e.target.files[0];
    if (!foleyFile) return;
    setFoleyUploading(true);
    const fd = new FormData();
    fd.append('file', foleyFile);
    try {
      const r = await fetch('http://localhost:5001/api/upload-foley', {
        method: 'POST',
        body: fd
      });
      const data = await r.json();
      if (data.success) {
        setMessage(`✅ Foley uploaded: ${data.filename}`);
        fetchFoleyLibrary();
      } else {
        setMessage(`❌ Foley upload failed: ${data.error}`);
      }
    } catch (err) {
      setMessage(`❌ Foley upload error: ${err.message}`);
    } finally {
      setFoleyUploading(false);
    }
  };

  // Insert foley to selected slice (from dropdown)
  const insertFoleyToSlice = () => {
    if (selectedSlice === null || !selectedFoleyForSlice) return;
    const existing = mappings.find(m => m.slice_index === selectedSlice);
    if (existing) {
      setMappings(prev => prev.map(m => 
        m.slice_index === selectedSlice 
          ? { ...m, foley_filename: selectedFoleyForSlice, gain: 1.0 } 
          : m
      ));
    } else {
      setMappings(prev => [...prev, { 
        slice_index: selectedSlice, 
        foley_filename: selectedFoleyForSlice, 
        gain: 1.0 
      }]);
    }
    setMessage(`✅ Mapped slice #${selectedSlice + 1} to ${selectedFoleyForSlice}`);
  };

  // Insert foley to selected slice (direct)
  const insertFoleyToSliceDirect = (foleyFilename) => {
    if (selectedSlice === null) {
      setMessage('⚠️ Please select a slice first');
      return;
    }
    const existing = mappings.find(m => m.slice_index === selectedSlice);
    if (existing) {
      setMappings(prev => prev.map(m => 
        m.slice_index === selectedSlice 
          ? { ...m, foley_filename: foleyFilename, gain: 1.0 } 
          : m
      ));
    } else {
      setMappings(prev => [...prev, { 
        slice_index: selectedSlice, 
        foley_filename: foleyFilename, 
        gain: 1.0 
      }]);
    }
    setMessage(`✅ Mapped slice #${selectedSlice + 1} to ${foleyFilename}`);
  };

  // Compose final audio with foley replacements
  const handleCompose = async () => {
    if (!filename || mappings.length === 0) {
      setMessage('⚠️ No mappings to compose');
      return;
    }
    setComposing(true);
    setMessage('🎚️ Composing new audio...');
    try {
      const r = await fetch('http://localhost:5001/api/compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, mappings })
      });
      const data = await r.json();
      if (data.success) {
        const cUrl = `http://localhost:5001/api/get-composed/${data.composed}?t=${Date.now()}`;
        setComposedUrl(cUrl);
        setMessage(`✅ Composed: ${data.composed}`);
        fetchComposeHistory();
      } else {
        setMessage(`❌ Compose failed: ${data.error}`);
      }
    } catch (err) {
      setMessage(`❌ Compose error: ${err.message}`);
    } finally {
      setComposing(false);
    }
  };

  // Fetch compose history
  const fetchComposeHistory = async () => {
    try {
      const r = await fetch('http://localhost:5001/api/compose-history');
      const data = await r.json();
      setComposeHistory(data.history || []);
    } catch (err) {
      console.error('Failed to fetch compose history:', err);
    }
  };

  // Load compose history on mount
  useEffect(() => {
    fetchComposeHistory();
  }, []);

  // Play video with composed audio (synchronized)
  const playVideoWithComposed = () => {
    if (!videoRef.current || !composedAudioRef.current) return;
    const v = videoRef.current;
    const a = composedAudioRef.current;
    v.muted = true;
    v.currentTime = 0;
    a.currentTime = 0;
    v.play();
    a.play();
    playingVideoComposedRef.current = true;
    
    // Sync interval to keep video and audio in sync
    const syncInterval = setInterval(() => {
      if (!playingVideoComposedRef.current) {
        clearInterval(syncInterval);
        return;
      }
      if (Math.abs(v.currentTime - a.currentTime) > 0.3) {
        a.currentTime = v.currentTime;
      }
    }, 100);
    
    v.onended = () => {
      a.pause();
      playingVideoComposedRef.current = false;
      clearInterval(syncInterval);
    };
    
    v.onpause = () => {
      a.pause();
    };
  };

  // Stop video with composed audio
  const stopVideoWithComposed = () => {
    if (videoRef.current) videoRef.current.pause();
    if (composedAudioRef.current) composedAudioRef.current.pause();
    playingVideoComposedRef.current = false;
  };

  // Delete foley file
  const handleDeleteFoley = async (foleyFilename) => {
    if (!window.confirm(`Delete ${foleyFilename}?`)) return;
    try {
      const r = await fetch('http://localhost:5001/api/delete-foley', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: foleyFilename })
      });
      const data = await r.json();
      if (data.success) {
        setMessage(`✅ Deleted: ${foleyFilename}`);
        // Remove any mappings using this foley
        setMappings(prev => prev.filter(m => m.foley_filename !== foleyFilename));
        fetchFoleyLibrary();
      } else {
        setMessage(`❌ Delete failed: ${data.error}`);
      }
    } catch (err) {
      setMessage(`❌ Delete error: ${err.message}`);
    }
  };

  // Play foley file preview
  const playFoleyPreview = async (foleyFilename) => {
    try {
      const r = await fetch(`http://localhost:5001/api/get-foley/${foleyFilename}`);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.play();
      audio.onended = () => URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to play foley:', err);
      setMessage('❌ Failed to play foley');
    }
  };

  // Analyze foley file (slice it into smaller samples)
  const handleAnalyzeFoley = async (foleyFilename) => {
    try {
      setMessage(`🔍 Analyzing ${foleyFilename}...`);
      
      const response = await fetch('http://localhost:5001/api/slice-foley', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: foleyFilename,
          method: 'onset',
          min_duration: 0.03,
          top_db: 30,
          enhance: foleyEnhance  // 应用 Foley 增强
        })
      });
      
      const data = await response.json();
      
      if (data.success) {
        let msg = `✅ Found ${data.slices.length} slices in ${foleyFilename}!`;
        if (foleyEnhance) {
          msg += ' 🎨 Enhanced.';
        }
        setMessage(msg);
        fetchFoleyLibrary();
      } else {
        setMessage(`❌ Analysis failed: ${data.error}`);
      }
    } catch (err) {
      console.error('Failed to analyze foley:', err);
      setMessage('❌ Failed to analyze foley');
    }
  };

  // Remove mapping
  const removeMapping = (sliceIndex) => {
    setMappings(prev => prev.filter(m => m.slice_index !== sliceIndex));
    setMessage(`✅ Removed mapping for slice #${sliceIndex + 1}`);
  };

  // Update mapping gain
  const updateMappingGain = (sliceIndex, newGain) => {
    setMappings(prev => prev.map(m => 
      m.slice_index === sliceIndex 
        ? { ...m, gain: newGain } 
        : m
    ));
  };

  return (
    <div className="App">
      <header>
        <h1>🎵 FOLEY FROM JUNK</h1>
        <p>AI-Powered Foley Sound Extraction & Replacement System</p>
      </header>

      <main>
        {!analysisData ? (
          <>
            <section className="card">
              <h2>📁 Upload Media</h2>
              <label className="upload-box" htmlFor="file-upload">
                <span className="upload-text">
                  {uploading ? '⏳ Uploading...' : '📤 Click to Upload'}
                </span>
                <span className="upload-hint">
                  Supports: Video (MP4, MOV, AVI) or Audio (WAV, MP3, FLAC)
                </span>
              </label>
              <input
                id="file-upload"
                type="file"
                accept="video/*,audio/*"
                onChange={handleFileUpload}
                style={{ display: 'none' }}
                disabled={uploading}
              />

              {filename && (
                <div style={{ marginTop: '20px', padding: '15px', background: 'rgba(0,217,255,0.1)', borderRadius: '8px' }}>
                  <strong>📄 File:</strong> {filename}<br />
                  <strong>📊 Type:</strong> {fileType}
                </div>
              )}
            </section>

            {filename && (
              <section className="card">
                <h2>⚙️ Analysis Settings</h2>
                <div className="settings">
                  <label>
                    <strong>Detection Method:</strong>
                    <select value={method} onChange={(e) => setMethod(e.target.value)}>
                      <option value="onset">Onset Detection (Recommended)</option>
                      <option value="silence">Silence Detection</option>
                    </select>
                  </label>

                  <label>
                    <strong>Minimum Duration (seconds):</strong>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={minDuration}
                      onChange={(e) => setMinDuration(parseFloat(e.target.value))}
                    />
                  </label>

                  {method === 'silence' && (
                    <label>
                      <strong>Silence Threshold (dB):</strong>
                      <input
                        type="number"
                        min="0"
                        max="80"
                        value={topDb}
                        onChange={(e) => setTopDb(parseInt(e.target.value))}
                      />
                    </label>
                  )}
                </div>

                <button
                  className="btn-primary"
                  onClick={handleAnalyze}
                  disabled={analyzing}
                  style={{ width: '100%', marginTop: '20px' }}
                >
                  {analyzing ? '🔍 Analyzing...' : '🚀 Analyze & Slice Audio'}
                </button>
              </section>
            )}
          </>
        ) : (
          <>
            {/* Media Player - 移到最顶部 */}
            {file && (
              <section className="card">
                <h2>🎬 Media Player</h2>
                {fileType === 'video' ? (
                  <video
                    ref={videoRef}
                    src={mediaUrl}
                    controls
                    style={{ 
                      width: '100%', 
                      maxWidth: '600px',
                      maxHeight: '400px',
                      borderRadius: '8px',
                      display: 'block',
                      margin: '0 auto'
                    }}
                    onTimeUpdate={(e) => setCurrentTime(e.target.currentTime)}
                  />
                ) : (
                  <audio
                    ref={audioRef}
                    src={mediaUrl}
                    controls
                    style={{ width: '100%' }}
                    onTimeUpdate={(e) => setCurrentTime(e.target.currentTime)}
                  />
                )}
              </section>
            )}

            {/* Summary Cards */}
            <div className="summary">
              <div className="summary-card">
                <div className="label">Total Duration</div>
                <div className="value">{(analysisData?.duration || 0).toFixed(1)}s</div>
              </div>
              <div className="summary-card">
                <div className="label">Sound Events</div>
                <div className="value">{analysisData?.num_slices || 0}</div>
              </div>
              <div className="summary-card">
                <div className="label">Categories</div>
                <div className="value">{analysisData?.num_clusters || 0}</div>
              </div>
              <div className="summary-card">
                <div className="label">Mappings</div>
                <div className="value">{mappings.length}</div>
              </div>
            </div>

            {/* Timeline Editor */}
            <section className="card">
              <h2>🎬 TIMELINE EDITOR</h2>
              <p style={{ color: 'var(--text-dim)', marginBottom: '20px' }}>
                Click on any sound event to preview. Different colors represent different sound types (8 categories).
                {selectedSlice !== null && ` Selected: Slice #${selectedSlice + 1}`}
              </p>
              
              <div className="timeline-container">
                <div className="timeline-track">
                  {(analysisData?.slices || []).map((slice, idx) => {
                    const totalDuration = analysisData?.duration || 1;
                    const start = slice.features?.start_time || 0;
                    const end = slice.features?.end_time || 0;
                    const left = (start / totalDuration) * 100;
                    const width = ((end - start) / totalDuration) * 100;
                    const isSelected = selectedSlice === idx;
                    const isPlaying = playingSlice === slice;

                    return (
                      <div
                        key={idx}
                        className={`timeline-segment ${isSelected ? 'selected' : ''} ${isPlaying ? 'playing' : ''}`}
                        style={{
                          left: `${left}%`,
                          width: `${width}%`,
                          background: getSoundTypeColor(slice.features?.type)  // 使用声音类型着色
                        }}
                        onClick={() => {
                          setSelectedSlice(idx);
                          previewSlice(slice);
                        }}
                      >
                        {(slice.features?.duration || 0).toFixed(2)}s
                      </div>
                    );
                  })}
                </div>

                <div className="time-markers">
                  {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
                    <span key={ratio} style={{ left: `${ratio * 100}%` }}>
                      {formatTime((analysisData?.duration || 0) * ratio)}
                    </span>
                  ))}
                </div>

                <div className="legend">
                  {/* 按声音类型分组显示 */}
                  {['impact', 'metallic', 'friction', 'liquid', 'burst', 'resonant', 'ambient', 'continuous'].map((soundType) => {
                    const slicesOfType = (analysisData?.slices || []).filter(s => s.features?.type === soundType);
                    if (slicesOfType.length === 0) return null; // 不显示没有的类型
                    
                    return (
                      <div key={soundType} className="legend-item">
                        <div
                          className="legend-color"
                          style={{ background: getSoundTypeColor(soundType) }}
                        />
                        <span>
                          {getSoundTypeLabel(soundType)} ({slicesOfType.length} event{slicesOfType.length !== 1 ? 's' : ''})
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

            {/* Foley Library & Compose History */}
            <section className="card">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px' }}>
                {/* Foley Library */}
                <div>
                  <h2>📚 Foley Resource Library</h2>
                  <p style={{ color: 'var(--text-dim)', marginBottom: '10px' }}>
                    Upload and manage your foley sound effects library.
                  </p>
                  
                  <label className="upload-box" htmlFor="foley-upload" style={{ marginBottom: '15px', display: 'inline-block' }}>
                    <span className="upload-text">
                      {foleyUploading ? '⏳ Uploading...' : '➕ Upload Foley'}
                    </span>
                  </label>
                  <input 
                    id="foley-upload" 
                    type="file" 
                    accept="audio/*" 
                    onChange={handleFoleyUpload} 
                    style={{ display: 'none' }} 
                    disabled={foleyUploading}
                  />
                  
                  {/* Foley 音色增强选项 */}
                  <div style={{ 
                    marginBottom: '15px',
                    padding: '12px', 
                    background: 'rgba(118,75,162,0.05)', 
                    borderRadius: '8px',
                    border: '1px solid rgba(118,75,162,0.2)'
                  }}>
                    <label style={{ 
                      display: 'flex', 
                      alignItems: 'center',
                      cursor: 'pointer',
                      fontSize: '0.95em'
                    }}>
                      <input 
                        type="checkbox" 
                        checked={foleyEnhance}
                        onChange={(e) => setFoleyEnhance(e.target.checked)}
                        style={{ marginRight: '10px' }}
                      />
                      <div>
                        <strong>🎨 Enable Timbre Enhancement</strong>
                        <div style={{ 
                          fontSize: '0.85em', 
                          color: 'var(--text-dim)', 
                          marginTop: '4px'
                        }}>
                          Automatically improve Foley sound quality when analyzing
                        </div>
                      </div>
                    </label>
                  </div>
                  
                  <div style={{ maxHeight: '400px', overflow: 'auto' }}>
                    {foleyLibrary.length === 0 ? (
                      <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-dim)' }}>
                        No foley files yet. Upload some audio files to get started!
                      </div>
                    ) : (
                      <div style={{ display: 'grid', gap: '10px' }}>
                        {foleyLibrary.map((f, i) => (
                          <div key={i} style={{ 
                            border: '1px solid rgba(0,0,0,0.1)', 
                            padding: '12px', 
                            borderRadius: '6px',
                            background: 'rgba(255,255,255,0.5)'
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                              <strong>{f.filename}</strong>
                              <div style={{ display: 'flex', gap: '6px' }}>
                                <button 
                                  onClick={() => playFoleyPreview(f.filename)}
                                  title="Play original file"
                                >
                                  ▶️ Play
                                </button>
                                <button 
                                  onClick={() => handleAnalyzeFoley(f.filename)}
                                  title="Analyze and slice this file"
                                  disabled={f.slices && f.slices.length > 0}
                                  style={{
                                    background: f.slices && f.slices.length > 0 ? '#ccc' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                                    color: 'white',
                                    border: 'none'
                                  }}
                                >
                                  🔍 Analyze
                                </button>
                                <button 
                                  onClick={() => insertFoleyToSliceDirect(f.filename)} 
                                  disabled={selectedSlice === null}
                                  title="Map to selected slice"
                                >
                                  ➕ Insert
                                </button>
                                <button 
                                  onClick={() => handleDeleteFoley(f.filename)} 
                                  style={{ color: '#a00' }}
                                  title="Delete file"
                                >
                                  🗑️
                                </button>
                              </div>
                            </div>
                            
                            {f.slices && f.slices.length > 0 && (
                              <div style={{ marginTop: '8px', paddingLeft: '10px', borderLeft: '2px solid rgba(0,217,255,0.3)' }}>
                                <em style={{ fontSize: '0.9em', color: 'var(--text-dim)' }}>
                                  {f.slices.length} slice{f.slices.length !== 1 ? 's' : ''}:
                                </em>
                                <ul style={{ margin: '5px 0', paddingLeft: '20px' }}>
                                  {f.slices.map((s, idx) => (
                                    <li key={idx} style={{ 
                                      display: 'flex', 
                                      gap: '8px', 
                                      alignItems: 'center',
                                      fontSize: '0.9em',
                                      marginBottom: '4px'
                                    }}>
                                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {s.filename}
                                      </span>
                                      <button 
                                        onClick={() => playFoleyPreview(s.filename)}
                                        style={{ fontSize: '0.85em' }}
                                      >
                                        ▶️
                                      </button>
                                      <button 
                                        onClick={() => insertFoleyToSliceDirect(s.filename)} 
                                        disabled={selectedSlice === null}
                                        style={{ fontSize: '0.85em' }}
                                      >
                                        ➕
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Compose History */}
                <div>
                  <h2>🧾 Modification Log</h2>
                  <p style={{ color: 'var(--text-dim)', marginBottom: '10px' }}>
                    Recent compose operations and mappings (audit trail).
                  </p>
                  <div style={{ maxHeight: '400px', overflow: 'auto' }}>
                    {composeHistory.length === 0 ? (
                      <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-dim)' }}>
                        No compose history yet.
                      </div>
                    ) : (
                      composeHistory.map((h, idx) => (
                        <div key={idx} style={{ 
                          padding: '12px', 
                          borderBottom: '1px solid #eee',
                          background: idx === 0 ? 'rgba(0,217,255,0.05)' : 'transparent'
                        }}>
                          <div style={{ marginBottom: '5px' }}>
                            <strong>{h.timestamp}</strong>
                          </div>
                          <div style={{ fontSize: '0.9em', color: 'var(--text-dim)' }}>
                            {h.original_file} → {h.composed_file}
                          </div>
                          <div style={{ fontSize: '0.85em', color: 'var(--text-dim)', marginTop: '4px' }}>
                            Mappings: {h.mappings.map(m => `#${m.slice_index + 1}→${m.foley_filename}`).join(', ')}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </section>

            {/* Sound Events List */}
            <section className="card">
              <h2>📝 Sound Events List</h2>
              <div className="slices-list">
                {(analysisData?.slices || []).map((slice, idx) => {
                  const mapping = mappings.find(m => m.slice_index === idx);
                  return (
                    <div
                      key={idx}
                      className={`slice-item ${selectedSlice === idx ? 'selected' : ''}`}
                      onClick={() => {
                        setSelectedSlice(idx);
                        previewSlice(slice);
                      }}
                      style={{
                        borderLeft: `4px solid ${getSoundTypeColor(slice.features?.type)}`
                      }}
                    >
                      <div className="slice-info">
                        <span className="slice-number">#{idx + 1}</span>
                        <span className="slice-type">{getSoundTypeLabel(slice.features?.type)}</span>
                        <span className="slice-time">
                          {formatTime(slice.features?.start_time || 0)} → {formatTime(slice.features?.end_time || 0)}
                        </span>
                        <span className="slice-duration">
                          {(slice.features?.duration || 0).toFixed(2)}s
                        </span>
                      </div>
                      <div className="slice-features">
                        <span>Energy: {((slice.features?.rms || 0) * 100).toFixed(1)}%</span>
                        <span>Freq: {(slice.features?.spectral_centroid || 0).toFixed(0)} Hz</span>
                        <span>Impact: {(slice.features?.onset_strength || 0).toFixed(2)}</span>
                      </div>
                      {mapping && (
                        <div style={{ 
                          marginTop: '8px', 
                          padding: '6px', 
                          background: 'rgba(0,217,255,0.1)', 
                          borderRadius: '4px',
                          fontSize: '0.9em'
                        }}>
                          Mapped to: <strong>{mapping.foley_filename}</strong>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              removeMapping(idx);
                            }}
                            style={{ marginLeft: '8px', fontSize: '0.85em' }}
                          >
                            Remove
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Actions */}
            <section className="card">
              <h2>🛠️ Actions</h2>
              <div className="actions">
                {/* Quick Mapping UI */}
                <div style={{ 
                  padding: '15px', 
                  background: 'rgba(0,217,255,0.05)', 
                  borderRadius: '8px',
                  marginBottom: '15px'
                }}>
                  <h3 style={{ marginTop: 0, fontSize: '1.1em' }}>Quick Mapping</h3>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <select 
                      value={selectedFoleyForSlice} 
                      onChange={(e) => setSelectedFoleyForSlice(e.target.value)}
                      style={{ flex: 1, minWidth: '200px' }}
                    >
                      <option value="">Select foley for slice #{selectedSlice !== null ? selectedSlice + 1 : '...'}</option>
                      {foleyLibrary.map(f => (
                        <option key={f.filename} value={f.filename}>{f.filename}</option>
                      ))}
                    </select>
                    <button 
                      onClick={insertFoleyToSlice} 
                      disabled={selectedSlice === null || !selectedFoleyForSlice}
                    >
                      ➕ Insert Foley
                    </button>
                  </div>
                  {selectedSlice !== null && analysisData?.slices?.[selectedSlice] && (
                    <div style={{ marginTop: '8px', fontSize: '0.9em', color: 'var(--text-dim)' }}>
                      Currently selected: Slice #{selectedSlice + 1} - {getSoundTypeLabel(analysisData.slices[selectedSlice].features.type)}
                    </div>
                  )}
                </div>

                {/* Current Mappings */}
                {mappings.length > 0 && (
                  <div style={{ 
                    marginBottom: '15px', 
                    padding: '15px', 
                    background: 'rgba(118,75,162,0.05)', 
                    borderRadius: '8px' 
                  }}>
                    <h3 style={{ marginTop: 0, fontSize: '1.1em' }}>
                      Current Mappings ({mappings.length})
                    </h3>
                    <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                      {mappings.map((m, i) => (
                        <li key={i} style={{ 
                          display: 'flex', 
                          gap: '8px', 
                          alignItems: 'center',
                          padding: '8px',
                          background: 'white',
                          marginBottom: '6px',
                          borderRadius: '4px'
                        }}>
                          <span style={{ fontWeight: 'bold' }}>Slice #{m.slice_index + 1}</span>
                          <span>→</span>
                          <span style={{ color: 'var(--primary)', flex: 1 }}>{m.foley_filename}</span>
                          <input 
                            type="range" 
                            min="0" 
                            max="2" 
                            step="0.1" 
                            value={m.gain || 1.0}
                            onChange={(e) => updateMappingGain(m.slice_index, parseFloat(e.target.value))}
                            style={{ width: '80px' }}
                            title={`Gain: ${(m.gain || 1.0).toFixed(1)}`}
                          />
                          <span style={{ fontSize: '0.85em', width: '40px' }}>
                            {((m.gain || 1.0) * 100).toFixed(0)}%
                          </span>
                          <button 
                            onClick={() => removeMapping(m.slice_index)}
                            style={{ color: '#a00' }}
                          >
                            ✖
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Compose Button */}
                <button 
                  onClick={handleCompose} 
                  disabled={composing || mappings.length === 0}
                  className="btn-primary"
                  style={{ width: '100%', marginBottom: '15px' }}
                >
                  {composing ? '🎚️ Composing...' : `🎚️ Compose Audio (${mappings.length} mapping${mappings.length !== 1 ? 's' : ''})`}
                </button>

                {/* Composed Audio Player */}
                {composedUrl && (
                  <div style={{ 
                    padding: '15px', 
                    background: 'rgba(0,255,136,0.05)', 
                    borderRadius: '8px',
                    marginBottom: '15px'
                  }}>
                    <h3 style={{ marginTop: 0, fontSize: '1.1em' }}>✅ Composed Audio</h3>
                    <audio 
                      ref={composedAudioRef} 
                      src={composedUrl} 
                      controls 
                      style={{ width: '100%', marginBottom: '10px' }} 
                    />
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      {fileType === 'video' && (
                        <>
                          <button onClick={playVideoWithComposed}>
                            ▶️ Play Video with Composed Audio
                          </button>
                          <button onClick={stopVideoWithComposed}>
                            ⏹️ Stop
                          </button>
                        </>
                      )}
                      <a 
                        href={composedUrl} 
                        download={`${filename}_composed.wav`}
                        style={{ 
                          display: 'inline-block',
                          padding: '8px 16px',
                          background: 'var(--primary)',
                          color: 'white',
                          textDecoration: 'none',
                          borderRadius: '4px'
                        }}
                      >
                        💾 Download Composed Audio
                      </a>
                    </div>
                  </div>
                )}

                {/* Other Actions */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
                  <button onClick={downloadJSON}>
                    💾 Download Analysis JSON
                  </button>
                  <button onClick={() => {
                    setAnalysisData(null);
                    setFile(null);
                    setFilename('');
                    setMessage('');
                    setMappings([]);
                    setComposedUrl(null);
                    setSelectedSlice(null);
                  }}>
                    🔄 Analyze New File
                  </button>
                  <button
                    onClick={() => alert('Hardware integration coming soon! This JSON can control Arduino/Raspberry Pi.')}
                    style={{ background: 'linear-gradient(135deg, #764ba2 0%, #667eea 100%)' }}
                  >
                    🔌 Send to Hardware
                  </button>
                  <button onClick={fetchFoleyLibrary}>
                    🔄 Refresh Library
                  </button>
                </div>
              </div>
            </section>

            {/* JSON Preview */}
            <details className="json-preview">
              <summary>👁️ View Raw JSON Data</summary>
              <pre>{JSON.stringify(analysisData, null, 2)}</pre>
            </details>
          </>
        )}
      </main>

      {message && (
        <div className={`message ${message.includes('✅') || message.includes('✨') ? 'success' : message.includes('⚠️') ? 'warning' : 'error'}`}>
          {message}
        </div>
      )}

      <footer>
        💡 This tool automatically detects and categorizes sound events for foley replacement
      </footer>
    </div>
  );
}

export default App;