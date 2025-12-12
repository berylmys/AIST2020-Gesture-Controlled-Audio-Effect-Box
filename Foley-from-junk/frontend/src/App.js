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
  
  // para
  const [method, setMethod] = useState('onset');
  const [minDuration, setMinDuration] = useState(0.02);
  const [topDb, setTopDb] = useState(30);
  
  const audioRef = useRef(null);
  const waveformRef = useRef(null);
  const videoRef = useRef(null);
  const previewAudioRef = useRef(null);

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
    } catch (error) {
      setMessage('❌ Upload failed: ' + error.message);
    } finally {
      setUploading(false);
    }
  };

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
        // 验证并修复数据，确保所有必要字段都存在
        const validatedSlices = data.slices.map(slice => ({
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
          cluster: slice.cluster ?? 0
        }));
        
        setAnalysisData({
          ...data,
          slices: validatedSlices
        });
        setMessage(`✨ Found ${data.num_slices} sound events in ${data.num_clusters} categories!`);
      } else {
        setMessage(`❌ ${data.error}. ${data.suggestion || ''}`);
      }
    } catch (error) {
      setMessage('❌ Analysis failed: ' + error.message);
    } finally {
      setAnalyzing(false);
    }
  };

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
    } catch (e) {}
  };

  const previewSlice = async (slice, options = { seekOnly: false }) => {
    // Seek main media (video or audio) to slice start and play; if mapping exists, play foley slice instead (muting main audio)
    stopPreview();
    try {
      const start = slice.features.start_time;
      const mapping = mappings.find(m => m.slice_index === (analysisData ? analysisData.slices.indexOf(slice) : -1));

      // seek and play main media
      if (file && fileType === 'video' && videoRef.current) {
        const v = videoRef.current;
        v.currentTime = start;
        // if we're previewing a foley, mute video audio
        if (mapping && mapping.foley_filename) {
          v.muted = true;
        } else {
          v.muted = false;
        }
        v.play();
      } else if (file && fileType !== 'video' && audioRef.current) {
        const a = audioRef.current;
        a.currentTime = start;
        if (mapping && mapping.foley_filename) a.muted = true; else a.muted = false;
        a.play();
      }

      // if there is a mapping and not seekOnly, play the mapped foley slice
      if (mapping && mapping.foley_filename && !options.seekOnly) {
        const fn = mapping.foley_filename;
        const r = await fetch(`http://localhost:5001/api/get-foley/${fn}`);
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        const pa = new Audio(url);
        previewAudioRef.current = pa;
        pa.play();
        setPlayingSlice(slice);
        pa.onended = () => {
          setPlayingSlice(null);
          stopPreview();
        };
      } else {
        // no mapping: just play main media for short period or until user stops
        setPlayingSlice(slice);
      }
    } catch (err) {
      console.error('Preview failed', err);
      stopPreview();
    }
  };

  const getClusterColor = (cluster) => {
    const colors = [
      '#00d9ff', '#ff00ff', '#00ff88', '#ffcc00',
      '#ff3d71', '#764ba2', '#667eea', '#f093fb'
    ];
    return colors[cluster % colors.length];
  };

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

  const formatTime = (sec) => {
    const m = Math.floor(sec / 60);
    const s = (sec % 60).toFixed(3);
    return `${m}:${s.padStart(6, '0')}`;
  };

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

  useEffect(() => {
    if (file && fileType === 'video') {
      const url = URL.createObjectURL(file);
      setMediaUrl(url);
      return () => URL.revokeObjectURL(url);
    } else if (file && fileType !== 'video') {
      const url = URL.createObjectURL(file);
      setMediaUrl(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [file, fileType]);

  const fetchFoleyLibrary = async () => {
    try {
      const r = await fetch('http://localhost:5001/api/foley-library');
      const data = await r.json();
      setFoleyLibrary(data.library || []);
    } catch (err) {
      console.error('Failed to fetch foley library', err);
    }
  };

  useEffect(() => {
    fetchFoleyLibrary();
  }, []);

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

  const insertFoleyToSlice = () => {
    if (selectedSlice === null || !selectedFoleyForSlice) return;
    const existing = mappings.find(m => m.slice_index === selectedSlice);
    if (existing) {
      setMappings(prev => prev.map(m => m.slice_index === selectedSlice ? { ...m, foley_filename: selectedFoleyForSlice, gain: 1.0 } : m));
    } else {
      setMappings(prev => [...prev, { slice_index: selectedSlice, foley_filename: selectedFoleyForSlice, gain: 1.0 }]);
    }
    setMessage(`✅ Mapped slice #${selectedSlice + 1} to ${selectedFoleyForSlice}`);
  };

  const insertFoleyToSliceDirect = (foleyFilename) => {
    if (selectedSlice === null) return;
    const existing = mappings.find(m => m.slice_index === selectedSlice);
    if (existing) {
      setMappings(prev => prev.map(m => m.slice_index === selectedSlice ? { ...m, foley_filename: foleyFilename, gain: 1.0 } : m));
    } else {
      setMappings(prev => [...prev, { slice_index: selectedSlice, foley_filename: foleyFilename, gain: 1.0 }]);
    }
    setMessage(`✅ Mapped slice #${selectedSlice + 1} to ${foleyFilename}`);
  };

  const handleCompose = async () => {
    if (!filename || mappings.length === 0) return;
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

  const fetchComposeHistory = async () => {
    try {
      const r = await fetch('http://localhost:5001/api/compose-history');
      const data = await r.json();
      setComposeHistory(data.history || []);
    } catch (err) {
      console.error('Failed to fetch compose history', err);
    }
  };

  useEffect(() => {
    fetchComposeHistory();
  }, []);

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

  const stopVideoWithComposed = () => {
    if (videoRef.current) videoRef.current.pause();
    if (composedAudioRef.current) composedAudioRef.current.pause();
    playingVideoComposedRef.current = false;
  };

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
        fetchFoleyLibrary();
      } else {
        setMessage(`❌ Delete failed: ${data.error}`);
      }
    } catch (err) {
      setMessage(`❌ Delete error: ${err.message}`);
    }
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
                      value={minDuration}
                      onChange={(e) => setMinDuration(parseFloat(e.target.value))}
                    />
                  </label>

                  {method === 'silence' && (
                    <label>
                      <strong>Silence Threshold (dB):</strong>
                      <input
                        type="number"
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
            {/* Summary Cards */}
            <div className="summary">
              <div className="summary-card">
                <div className="label">Total Duration</div>
                <div className="value">{analysisData.duration.toFixed(1)}s</div>
              </div>
              <div className="summary-card">
                <div className="label">Sound Events</div>
                <div className="value">{analysisData.num_slices}</div>
              </div>
              <div className="summary-card">
                <div className="label">Categories</div>
                <div className="value">{analysisData.num_clusters}</div>
              </div>
            </div>

            {/* Media Player */}
            {file && (
              <section className="card">
                <h2>🎬 Media Player</h2>
                {fileType === 'video' ? (
                  <video
                    ref={videoRef}
                    src={mediaUrl}
                    controls
                    style={{ width: '100%', borderRadius: '8px' }}
                  />
                ) : (
                  <audio
                    ref={audioRef}
                    src={mediaUrl}
                    controls
                    style={{ width: '100%' }}
                  />
                )}
              </section>
            )}

            {/* Timeline Editor */}
            <section className="card">
              <h2>🎬 TIMELINE EDITOR</h2>
              <p style={{ color: 'var(--text-dim)', marginBottom: '20px' }}>
                Click on any sound event to preview. Different colors represent different sound categories.
              </p>
              
              <div className="timeline-container">
                <div className="timeline-track">
                  {analysisData.timeline.map((seg, idx) => {
                    const totalDuration = analysisData.duration;
                    const left = (seg.start / totalDuration) * 100;
                    const width = ((seg.end - seg.start) / totalDuration) * 100;
                    const isSelected = selectedSlice === idx;
                    const isPlaying = playingSlice === analysisData.slices[idx];

                    return (
                      <div
                        key={idx}
                        className={`timeline-segment ${isSelected ? 'selected' : ''} ${isPlaying ? 'playing' : ''}`}
                        style={{
                          left: `${left}%`,
                          width: `${width}%`,
                          background: getClusterColor(seg.cluster)
                        }}
                        onClick={() => {
                          setSelectedSlice(idx);
                          previewSlice(analysisData.slices[idx]);
                        }}
                      >
                        {seg.duration.toFixed(2)}s
                      </div>
                    );
                  })}
                </div>

                <div className="time-markers">
                  {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
                    <span key={ratio} style={{ left: `${ratio * 100}%` }}>
                      {formatTime(analysisData.duration * ratio)}
                    </span>
                  ))}
                </div>

                <div className="legend">
                  {Array.from(new Set(analysisData.slices.map(s => s.cluster))).sort().map((cluster) => {
                    const slicesInCluster = analysisData.slices.filter(s => s.cluster === cluster);
                    const types = [...new Set(slicesInCluster.map(s => s.features.type))];
                    return (
                      <div key={cluster} className="legend-item">
                        <div
                          className="legend-color"
                          style={{ background: getClusterColor(cluster) }}
                        />
                        <span>
                          Category {cluster + 1}: {types.map(t => getSoundTypeLabel(t)).join(', ')} ({slicesInCluster.length} events)
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

            {/* Foley Resource Library & Compose History in two columns */}
            <section className="card">
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px' }}>

                    {/* Foley library */}
                    <section className="card">
                      <h2>📚 Foley Resource Library</h2>
                      <p style={{ color: 'var(--text-dim)' }}>Upload and manage your foley sound effects library.</p>
                      <div style={{ display: 'grid', gap: '10px' }}>
                        {foleyLibrary.map((f, i) => (
                          <div key={i} style={{ border: '1px solid rgba(0,0,0,0.06)', padding: '8px', borderRadius: '6px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <strong>{f.filename}</strong>
                              <div style={{ display: 'flex', gap: '6px' }}>
                                <button onClick={() => {
                                  // play original foley file if directly available
                                  fetch(`http://localhost:5001/api/get-foley/${f.filename}`).then(r=>r.blob()).then(b=>{const u=URL.createObjectURL(b); new Audio(u).play(); setTimeout(()=>URL.revokeObjectURL(u),5000)}).catch(()=>{});
                                }}>▶️ Play</button>
                                <button onClick={() => insertFoleyToSliceDirect(f.filename)} disabled={selectedSlice == null}>➕ Insert</button>
                                <button onClick={() => handleDeleteFoley(f.filename)} style={{ color: '#a00' }}>🗑️ Delete</button>
                              </div>
                            </div>
                            {f.slices && f.slices.length > 0 ? (
                              <div style={{ marginTop: '6px' }}>
                                <em>Slices:</em>
                                <ul>
                                  {f.slices.map((s, idx) => (
                                            <li key={idx} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                              <span style={{ flex: 1 }}>{s.filename}</span>
                                              <button onClick={()=>{fetch(`http://localhost:5001/api/get-foley/${s.filename}`).then(r=>r.blob()).then(b=>{const u=URL.createObjectURL(b); new Audio(u).play(); setTimeout(()=>URL.revokeObjectURL(u),5000)}).catch(()=>{});}}>▶️</button>
                                              <button onClick={() => insertFoleyToSliceDirect(s.filename)} disabled={selectedSlice == null}>➕ Insert</button>
                                            </li>
                                          ))}
                                </ul>
                              </div>
                            ) : (
                              <div style={{ marginTop: '6px' }}><em>No slices available</em></div>
                            )}
                          </div>
                        ))}
                      </div>
                    </section>

                    {/* Compose history (audit log) */}
                    <section className="card">
                      <h2>🧾 Modification Log</h2>
                      <p style={{ color: 'var(--text-dim)' }}>Recent compose operations and mappings (audit trail).</p>
                      <div style={{ maxHeight: '240px', overflow: 'auto' }}>
                        {composeHistory.length === 0 && <div>No compose history yet.</div>}
                        {composeHistory.map((h, idx) => (
                          <div key={idx} style={{ padding: '8px', borderBottom: '1px solid #eee' }}>
                            <div><strong>{h.timestamp}</strong> — {h.original_file} → {h.composed_file}</div>
                            <div style={{ fontSize: '0.9em', color: 'var(--text-dim)' }}>
                              Mappings: {h.mappings.map(m => `${m.slice_index}@${m.foley_filename}`).join(', ')}
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>

                      </div>
                    </section>

            {/* list */}
            <section className="card">
              <h2>📝 Sound Events List</h2>
              <div className="slices-list">
                {analysisData.slices.map((slice, idx) => (
                  <div
                    key={idx}
                    className={`slice-item ${selectedSlice === idx ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedSlice(idx);
                      previewSlice(slice);
                    }}
                    style={{
                      borderLeft: `4px solid ${getClusterColor(slice.cluster)}`
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
                  </div>
                ))}
              </div>
            </section>

            {/* buttons */}
            <section className="card">
              <h2>🛠️ Actions</h2>
              <div className="actions">
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <label className="upload-box" htmlFor="foley-upload" style={{ padding: '6px 10px' }}>
                    <span className="upload-text">➕ Upload Foley</span>
                  </label>
                  <input id="foley-upload" type="file" accept="audio/*" onChange={handleFoleyUpload} style={{ display: 'none' }} />
                  <button onClick={fetchFoleyLibrary}>📚 Refresh Library</button>
                </div>

                {/* quick mapping UI */}
                <div style={{ marginTop: '8px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <select value={selectedFoleyForSlice} onChange={(e) => setSelectedFoleyForSlice(e.target.value)}>
                    <option value="">Select Foley for selected slice</option>
                    {foleyLibrary.map(f => (
                      <option key={f.filename} value={f.filename}>{f.filename}</option>
                    ))}
                  </select>
                  <button onClick={insertFoleyToSlice} disabled={selectedSlice == null || !selectedFoleyForSlice}>Insert Foley</button>
                  <button onClick={handleCompose} disabled={composing || mappings.length === 0}>{composing ? 'Composing...' : '🎚️ Compose'}</button>
                </div>

                {/* Current mappings */}
                {mappings.length > 0 && (
                  <div style={{ marginTop: '12px' }}>
                    <strong>Current Mappings:</strong>
                    <ul>
                      {mappings.map((m, i) => (
                        <li key={i} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <span>Slice #{m.slice_index + 1}</span>
                          <span style={{ color: 'var(--primary)' }}>{m.foley_filename}</span>
                          <button onClick={() => {
                            // remove mapping
                            setMappings(prev => prev.filter(x => !(x.slice_index === m.slice_index && x.foley_filename === m.foley_filename)));
                          }}>Remove</button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {composedUrl && (
                  <div style={{ marginTop: '8px' }}>
                    <audio ref={composedAudioRef} src={composedUrl} controls style={{ width: '100%' }} />
                    <div style={{ display: 'flex', gap: '8px', marginTop: '6px', alignItems: 'center' }}>
                      {fileType === 'video' && (
                        <>
                          <button onClick={playVideoWithComposed}>▶️ Play Video with Composed Audio</button>
                          <button onClick={stopVideoWithComposed}>⏹️ Stop</button>
                        </>
                      )}
                      <a href={composedUrl} download={`${filename}_composed.wav`} style={{ marginLeft: '8px' }}>💾 Download Composed</a>
                    </div>
                  </div>
                )}

                <button onClick={downloadJSON}>
                  💾 Download Analysis JSON
                </button>
                <button onClick={() => {
                  setAnalysisData(null);
                  setFile(null);
                  setFilename('');
                  setMessage('');
                }}>
                  🔄 Analyze New File
                </button>
                <button
                  onClick={() => alert('Hardware integration coming soon! This JSON can control Arduino/Raspberry Pi.')}
                  style={{ background: 'linear-gradient(135deg, #764ba2 0%, #667eea 100%)' }}
                >
                  🔌 Send to Hardware
                </button>
              </div>
            </section>

            {/* JSON preview */}
            <details className="json-preview">
              <summary>👁️ View Raw JSON Data</summary>
              <pre>{JSON.stringify(analysisData, null, 2)}</pre>
            </details>
          </>
        )}
      </main>

      {message && (
        <div className={`message ${message.includes('✅') || message.includes('✨') ? 'success' : 'error'}`}>
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