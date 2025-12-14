"""
Foley From Junk - Flask Backend Server
Clean architecture with separated concerns:
- soundExtracting.py: Audio processing library (loading, slicing, analysis, 8-class classification)
- videoProcessing.py: Video processing library (audio extraction, video info)
- app.py: Flask API server (HTTP endpoints, file management, business logic)
"""

from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from werkzeug.utils import secure_filename
import os
import json
import traceback
from pathlib import Path
import numpy as np
import librosa
import soundfile as sf
import shutil
from sklearn.cluster import KMeans
from datetime import datetime
from timbre_enhance import ( 
    apply_timbre_preset,
    generate_pitch_variants,
    batch_enhance_directory
)
# Import our custom libraries
import soundExtracting
import videoProcessing

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})

app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024
UPLOAD_FOLDER = 'uploads'
OUTPUT_FOLDER = 'outputs'
SLICES_FOLDER = 'outputs/slices'
FOLEY_FOLDER = 'outputs/foley_library'
FOLEY_DB = os.path.join(OUTPUT_FOLDER, 'foley_library.json')
COMPOSE_HISTORY = os.path.join(OUTPUT_FOLDER, 'compose_history.json')

for folder in [UPLOAD_FOLDER, OUTPUT_FOLDER, SLICES_FOLDER]:
    os.makedirs(folder, exist_ok=True)
os.makedirs(FOLEY_FOLDER, exist_ok=True)

# ==================== Audio Processing (using soundExtracting library) ====================

# Direct references to soundExtracting functions
load_audio = soundExtracting.load_audio
normalize_audio = soundExtracting.normalize_audio
fade_in_out = soundExtracting.fade_in_out

def detect_onset_slices(y, sr, hop_length=512, min_duration=0.02):
    """Wrapper for soundExtracting.detect_onset_slices"""
    return soundExtracting.detect_onset_slices(y, sr, hop_length=hop_length, min_duration=min_duration)

def detect_silence_slices(y, sr, top_db=30, min_duration=0.03):
    """Wrapper for soundExtracting.detect_slices_by_silence"""
    return soundExtracting.detect_slices_by_silence(y, sr, top_db=top_db, min_duration=min_duration)

def analyze_slice_features(y, sr):
    """
    Analyze audio slice features using soundExtracting library
    Now includes 8-class sound type classification:
    - impact, metallic, friction, liquid, burst, resonant, ambient, continuous
    """
    # Use soundExtracting's enhanced analyze_slice function
    features = soundExtracting.analyze_slice(y, sr)
    
    # Add backwards compatibility mappings
    features['spectral_centroid'] = features['spec_cent']
    features['spectral_bandwidth'] = features.get('spec_bw', 0)
    features['onset_strength'] = features.get('onset_strength', 0)
    
    return features

def save_slice(y, sr, output_dir, base_name, idx, features, enhance=False):
    """save slices with optional timbre enhancement"""
    y = normalize_audio(y)
    y = fade_in_out(y, sr, fade_ms=5)
    
    # 新增：如果启用增强，应用音色预设
    if enhance:
        sound_type = features.get('type', 'continuous')
        y = apply_timbre_preset(y, sr, sound_type)
    
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    
    filename = f"{base_name}_slice{idx:03d}.wav"
    filepath = output_dir / filename
    
    sf.write(str(filepath), y, sr)
    
    return {
        'filename': filename,
        'path': str(filepath),
        'features': features
    }

# ==================== API 端点 ====================

@app.route('/api/health', methods=['GET'])
def health_check():
    """robust"""
    return jsonify({
        'status': 'ok',
        'message': 'Enhanced Foley Backend Running!',
        'version': '2.0'
    })

@app.route('/api/upload', methods=['POST'])
def upload_file():
    """Upload video or audio files"""
    try:
        if 'file' not in request.files:
            return jsonify({'success': False, 'error': 'No file provided'}), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({'success': False, 'error': 'Empty filename'}), 400
        
        filename = secure_filename(file.filename)
        filepath = os.path.join(UPLOAD_FOLDER, filename)
        file.save(filepath)
        
        # Use videoProcessing library to determine file type
        file_type = 'video' if videoProcessing.is_video_file(filepath) else 'audio'
        
        return jsonify({
            'success': True,
            'filename': filename,
            'filepath': filepath,
            'file_type': file_type,
            'size': os.path.getsize(filepath)
        })
    
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/analyze-and-slice', methods=['POST'])
def analyze_and_slice():
    """
    核心功能：分析并切片音频
    支持：视频文件、音频文件、自定义参数
    """
    try:
        data = request.json
        filename = data.get('filename')
        method = data.get('method', 'onset')  # onset 或 silence
        min_duration = data.get('min_duration', 0.02)
        top_db = data.get('top_db', 30)
        # 修正：原视频不需要增强
        enhance = False
        
        if not filename:
            return jsonify({'success': False, 'error': 'No filename provided'}), 400
        
        filepath = os.path.join(UPLOAD_FOLDER, filename)
        if not os.path.exists(filepath):
            return jsonify({'success': False, 'error': 'File not found'}), 404
        
        print(f"\n{'='*60}")
        print(f"Processing: {filename}")
        print(f"Method: {method}, Min Duration: {min_duration}s")
        print(f"{'='*60}\n")
        
        # 1. Extract audio (use videoProcessing library for videos)
        if videoProcessing.is_video_file(filepath):
            print("Extracting audio from video...")
            temp_audio = os.path.join(OUTPUT_FOLDER, 'temp_extracted_audio.wav')
            audio_path = videoProcessing.extract_audio_from_video(filepath, temp_audio)
            if not audio_path:
                return jsonify({'success': False, 'error': 'Audio extraction failed'}), 500
        else:
            audio_path = filepath
        
        # 2. load audio
        print("Loading audio...")
        y, sr = load_audio(audio_path)
        duration = len(y) / sr
        print(f"Duration: {duration:.2f} seconds\n")
        
        # 3. slice detection
        print(f"Detecting slices using {method} method...")
        if method == 'onset':
            intervals = detect_onset_slices(y, sr, min_duration=min_duration)
        else:
            intervals = detect_silence_slices(y, sr, top_db=top_db, min_duration=min_duration)
        
        print(f"Found {len(intervals)} slices\n")
        
        if len(intervals) == 0:
            return jsonify({
                'success': False,
                'error': 'No slices detected. Try adjusting parameters.',
                'suggestion': 'Lower min_duration or sensitivity'
            }), 400
        
        # 4. processing slices
        print("Processing slices...")
        slices_data = []
        base_name = Path(filename).stem
        
        for idx, (start, end) in enumerate(intervals):
            slice_audio = y[start:end]
            start_time = start / sr
            end_time = end / sr
            
            # 分析特征
            features = analyze_slice_features(slice_audio, sr)
            features['start_time'] = start_time
            features['end_time'] = end_time
            features['duration'] = end_time - start_time
            
            # 保存切片
            slice_info = save_slice(
                slice_audio, sr, SLICES_FOLDER, base_name, idx, features,
                enhance=enhance  # 传递增强参数
            )
            
            slices_data.append(slice_info)
            
            print(f"  Slice {idx+1}: {start_time:.2f}s - {end_time:.2f}s "
                  f"({features['duration']:.2f}s) [{features['type']}]")
        
        # 5. Cluster similar sounds using comprehensive features
        print("\nClustering similar sounds...")

        sound_types = list(set(s['features'].get('type', 'unknown') for s in slices_data))
        sound_types.sort()
        n_clusters = min(4, len(slices_data))
        
        if n_clusters > 1:
            feature_vectors = []
            for s in slices_data:
                f = s['features']
                vec = [
                    f.get('rms', 0),
                    f.get('zcr', 0),
                    f.get('spec_cent', 0),
                    f.get('spec_bw', 0),
                    f.get('onset_strength', 0),
                    f.get('duration', 0),
                    f.get('spec_rolloff', 0),
                    f.get('spec_flatness', 0),
                    f.get('mfcc1', 0),
                    f.get('mfcc2', 0),
                    f.get('mfcc3', 0)
                ]
                feature_vectors.append(vec)
            
            X = np.array(feature_vectors)
            X_mean = X.mean(axis=0)
            X_std = X.std(axis=0) + 1e-8
            X_normalized = (X - X_mean) / X_std
            
            kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init=10).fit(X_normalized)
            
            clusters_result = []
            for cluster_id in range(n_clusters):
                member_indices = [i for i, label in enumerate(kmeans.labels_) if label == cluster_id]
                members = [slices_data[i] for i in member_indices]
                
                # Representative feature: use centroid features
                avg_features = {}
                for key in ['rms', 'zcr', 'spec_cent', 'duration']:
                    vals = [m['features'].get(key, 0) for m in members]
                    avg_features[key] = float(np.mean(vals)) if vals else 0.0
                
                # Most common type in cluster
                types_in_cluster = [m['features'].get('type', 'unknown') for m in members]
                from collections import Counter
                dominant_type = Counter(types_in_cluster).most_common(1)[0][0] if types_in_cluster else 'unknown'
                
                clusters_result.append({
                    'cluster_id': int(cluster_id),
                    'count': len(members),
                    'members': member_indices,
                    'avg_features': avg_features,
                    'dominant_type': dominant_type
                })
            
            print(f"Clustered into {n_clusters} groups\n")
        else:
            clusters_result = [{
                'cluster_id': 0,
                'count': len(slices_data),
                'members': list(range(len(slices_data))),
                'avg_features': {},
                'dominant_type': slices_data[0]['features'].get('type', 'unknown') if slices_data else 'unknown'
            }]
        
        # 6. Generate timeline for UI visualization
        print("Generating timeline data...")
        timeline_data = []
        for idx, s in enumerate(slices_data):
            f = s['features']
            timeline_data.append({
                'index': idx,
                'start': f.get('start_time', 0),
                'end': f.get('end_time', 0),
                'duration': f.get('duration', 0),
                'type': f.get('type', 'unknown'),
                'filename': s['filename']
            })
        
        print("✓ Processing complete!\n")
        
        return jsonify({
            'success': True,
            'slices': slices_data,
            'clusters': clusters_result,
            'timeline': timeline_data,
            'sound_types': sound_types,
            'stats': {
                'total_slices': len(slices_data),
                'duration': duration,
                'method': method
            }
        })
    
    except Exception as e:
        print(traceback.format_exc())
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/get-slice/<filename>')
def get_slice(filename):
    """Serve a slice audio file"""
    try:
        filepath = os.path.join(SLICES_FOLDER, secure_filename(filename))
        if not os.path.exists(filepath):
            return jsonify({'error': 'File not found'}), 404
        return send_file(filepath, mimetype='audio/wav')
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/upload-foley', methods=['POST'])
def upload_foley():
    """Upload a foley sound to the library (with automatic slicing)"""
    try:
        if 'file' not in request.files:
            return jsonify({'success': False, 'error': 'No file provided'}), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({'success': False, 'error': 'Empty filename'}), 400
        
        filename = secure_filename(file.filename)
        filepath = os.path.join(FOLEY_FOLDER, filename)
        file.save(filepath)
        
        # 🆕 AUTO-SLICE: Analyze and slice the uploaded foley (like original version)
        try:
            # Create per-foley slice folder
            base = Path(filename).stem
            foley_slice_dir = os.path.join(FOLEY_FOLDER, f"{base}_slices")
            os.makedirs(foley_slice_dir, exist_ok=True)
            
            # Use soundExtracting.process_file to create slices and features
            slice_paths, slice_features = soundExtracting.process_file(
                filepath, 
                foley_slice_dir, 
                method='silence',  # Default method
                analyze=True
            )
            
            features = {
                'slice_count': len(slice_paths),
                'slices': [
                    {
                        'path': p,
                        'filename': os.path.basename(p),
                        'features': f
                    } for p, f in zip(slice_paths, slice_features)
                ]
            }
        except Exception as slice_error:
            # Fallback: If slicing fails, just analyze the whole file
            print(f"Auto-slicing failed: {slice_error}, falling back to whole file analysis")
            try:
                y, sr = load_audio(filepath)
                features = analyze_slice_features(y, sr)
                features['slice_count'] = 0
            except Exception:
                features = {'slice_count': 0}
        
        # Store in DB
        db = []
        if os.path.exists(FOLEY_DB):
            try:
                with open(FOLEY_DB, 'r', encoding='utf-8') as f:
                    db = json.load(f)
            except Exception:
                db = []
        
        # Check if exists and remove old entry
        db = [e for e in db if e.get('filename') != filename]
        
        # Add new entry
        entry = {
            'filename': filename,
            'path': filepath,
            'features': features,
            'slices_dir': os.path.join(FOLEY_FOLDER, f"{Path(filename).stem}_slices") if features.get('slice_count', 0) > 0 else None,
            'uploaded_at': datetime.utcnow().isoformat() + 'Z'
        }
        db.append(entry)
        
        try:
            with open(FOLEY_DB, 'w', encoding='utf-8') as f:
                json.dump(db, f, indent=2)
        except Exception:
            pass
        
        return jsonify({
            'success': True,
            'filename': filename,
            'entry': entry
        })
    
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/slice-foley', methods=['POST'])
def slice_foley():
    """
    Slice a foley file into smaller samples and store them in a subfolder.
    Expects JSON: { 'filename': 'name.wav', 'method': 'onset', 'min_duration': 0.02 }
    Returns: { 'success': true, 'slices': [...], 'slices_dir': '...' }
    """
    try:
        data = request.json
        if not data or 'filename' not in data:
            return jsonify({'success': False, 'error': 'filename required'}), 400
        
        filename = secure_filename(data['filename'])
        method = data.get('method', 'onset')
        min_duration = data.get('min_duration', 0.02)
        top_db = data.get('top_db', 30)
        
        # foley enhancement
        enhance = data.get('enhance', False)
        
        filepath = os.path.join(FOLEY_FOLDER, filename)
        if not os.path.exists(filepath):
            return jsonify({'success': False, 'error': 'File not found'}), 404
        
        # load audio
        y, sr = load_audio(filepath)
        
        # detect slices
        if method == 'onset':
            intervals = detect_onset_slices(y, sr, min_duration=min_duration)
        else:
            intervals = detect_silence_slices(y, sr, top_db=top_db, min_duration=min_duration)
        
        if len(intervals) == 0:
            return jsonify({'success': False, 'error': 'No slices detected'}), 400
        
        # create subdirectory for slices
        base_name = Path(filename).stem
        slices_dir = os.path.join(FOLEY_FOLDER, f"{base_name}_slices")
        os.makedirs(slices_dir, exist_ok=True)
        
        # save slices
        slices_data = []
        for idx, (start, end) in enumerate(intervals):
            slice_audio = y[start:end]
            start_time = start / sr
            end_time = end / sr
            
            features = analyze_slice_features(slice_audio, sr)
            features['start_time'] = start_time
            features['end_time'] = end_time
            features['duration'] = end_time - start_time
            
            # save to slices_dir
            slice_info = save_slice(
                slice_audio, sr, slices_dir, base_name, idx, features,
                enhance=enhance  #  Foley enhancement
            )
            slices_data.append(slice_info)
        
        # update DB entry
        db = []
        if os.path.exists(FOLEY_DB):
            try:
                with open(FOLEY_DB, 'r', encoding='utf-8') as f:
                    db = json.load(f)
            except Exception:
                db = []
        
        for e in db:
            if e.get('filename') == filename:
                e['slices'] = slices_data
                e['slices_dir'] = slices_dir
                break
        
        try:
            with open(FOLEY_DB, 'w', encoding='utf-8') as f:
                json.dump(db, f, indent=2)
        except Exception:
            pass
        
        return jsonify({'success': True, 'slices': slices_data, 'slices_dir': slices_dir})
    
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/foley-library', methods=['GET'])
def get_foley_library():
    """Return all foley files in the library"""
    try:
        db = []
        if os.path.exists(FOLEY_DB):
            try:
                with open(FOLEY_DB, 'r', encoding='utf-8') as f:
                    db = json.load(f)
            except Exception:
                db = []
        return jsonify({'success': True, 'library': db})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/compose-history', methods=['GET'])
def get_compose_history():
    """
    🆕 NEW ENDPOINT: Get composition history
    Returns list of previous compose operations for reference
    """
    try:
        history = []
        if os.path.exists(COMPOSE_HISTORY):
            try:
                with open(COMPOSE_HISTORY, 'r', encoding='utf-8') as f:
                    history = json.load(f)
            except Exception:
                history = []
        return jsonify({'success': True, 'history': history})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e), 'history': []}), 500

@app.route('/api/compose', methods=['POST'])
def compose_audio():
    """
    Compose a new audio track by replacing slices with foley samples.
    Expects JSON:
    {
      'filename': 'original.wav',
      'mappings': [
        {'slice_index': 0, 'foley_filename': 'kick.wav', 'gain': 1.0},
        {'slice_index': 2, 'foley_filename': 'snare.wav', 'gain': 0.8},
        ...
      ]
    }
    Returns: { 'success': true, 'composed': 'composed.wav', 'path': '...' }
    """
    try:
        data = request.json
        if not data or 'filename' not in data:
            return jsonify({'success': False, 'error': 'filename required'}), 400
        filename = data['filename']
        mappings = data.get('mappings', [])

        # load original audio (or temp_extracted if video)
        filepath = os.path.join(UPLOAD_FOLDER, filename)
        if not os.path.exists(filepath):
            return jsonify({'success': False, 'error': 'Original file not found'}), 404

        # check if video -> extract audio again
        if videoProcessing.is_video_file(filepath):
            temp_audio = os.path.join(OUTPUT_FOLDER, 'temp_compose_audio.wav')
            src_audio_path = videoProcessing.extract_audio_from_video(filepath, temp_audio)
            if not src_audio_path:
                return jsonify({'success': False, 'error': 'Audio extraction failed'}), 500
        else:
            src_audio_path = filepath

        y, sr = load_audio(src_audio_path, sr=None)
        out = y.copy()

        # find slices metadata
        # We assume slices are stored for this file (analyze-and-slice was called before)
        # read from slices folder
        base_name = Path(filename).stem
        slices_files = sorted([f for f in os.listdir(SLICES_FOLDER) if f.startswith(base_name + '_slice') and f.endswith('.wav')])
        if len(slices_files) == 0:
            return jsonify({'success': False, 'error': 'No slices found for this file. Please analyze first.'}), 400

        # load each slice's metadata (we saved features in slice files, but we can also parse them)
        # For simplicity, we'll re-detect slices quickly
        # But ideally we'd store slice info in a session or DB. For MVP, re-slice:
        intervals = detect_onset_slices(y, sr, min_duration=0.02)
        slices = []
        for idx, (start, end) in enumerate(intervals):
            slice_audio = y[start:end]
            start_time = start / sr
            end_time = end / sr
            features = analyze_slice_features(slice_audio, sr)
            features['start_time'] = start_time
            features['end_time'] = end_time
            slices.append({'features': features})

        # apply mappings
        for m in mappings:
            idx = int(m.get('slice_index', -1))
            foley_fn = m.get('foley_filename')
            gain = float(m.get('gain', 1.0))
            if idx < 0 or idx >= len(slices):
                continue

            slice_feat = slices[idx]['features']
            start_time = float(slice_feat.get('start_time', 0.0))
            end_time = float(slice_feat.get('end_time', start_time))
            start_sample = int(start_time * sr)
            end_sample = int(end_time * sr)
            slice_len = end_sample - start_sample

            # locate foley file (may be in subdir)
            foley_path = None
            candidate = os.path.join(FOLEY_FOLDER, foley_fn)
            if os.path.exists(candidate):
                foley_path = candidate
            else:
                # search recursively
                for root, dirs, files in os.walk(FOLEY_FOLDER):
                    if foley_fn in files:
                        foley_path = os.path.join(root, foley_fn)
                        break
                    
            if not foley_path or not os.path.exists(foley_path):
                continue

            fy, fsr = load_audio(foley_path, sr=sr)
            # apply gain
            fy = fy * gain

            # ensure new segment matches slice length: trim or pad with silence
            if len(fy) > slice_len:
                new_seg = fy[:slice_len]
            elif len(fy) < slice_len:
                pad = slice_len - len(fy)
                new_seg = np.pad(fy, (0, pad), mode='constant')
            else:
                new_seg = fy

            # replace slice region with new segment
            if end_sample > len(out):
                # pad out if slice extends beyond original (shouldn't typically happen)
                out = np.pad(out, (0, end_sample - len(out)), mode='constant')
            out[start_sample:end_sample] = new_seg

        # normalize final mix to avoid clipping
        out = normalize_audio(out, peak=0.98)

        composed_name = f"{Path(filename).stem}_composed.wav"
        composed_path = os.path.join(OUTPUT_FOLDER, composed_name)
        sf.write(composed_path, out, sr)

        # cleanup temp audio
        try:
            if 'temp_compose_audio.wav' in src_audio_path and os.path.exists(src_audio_path):
                os.remove(src_audio_path)
        except:
            pass

        # record compose history (audit)
        try:
            history = []
            if os.path.exists(COMPOSE_HISTORY):
                with open(COMPOSE_HISTORY, 'r', encoding='utf-8') as hf:
                    history = json.load(hf)
        except Exception:
            history = []

        hist_entry = {
            'timestamp': datetime.utcnow().isoformat() + 'Z',
            'original_file': filename,
            'composed_file': composed_name,
            'composed_path': composed_path,
            'mappings': mappings,
            'duration_samples': int(len(out)),
            'sr': int(sr)
        }
        history.insert(0, hist_entry)
        try:
            with open(COMPOSE_HISTORY, 'w', encoding='utf-8') as hf:
                json.dump(history, hf, indent=2)
        except Exception:
            pass

        return jsonify({'success': True, 'composed': composed_name, 'path': composed_path})
    except Exception as e:
        print(traceback.format_exc())
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/get-composed/<filename>')
def get_composed(filename):
    try:
        filepath = os.path.join(OUTPUT_FOLDER, secure_filename(filename))
        if not os.path.exists(filepath):
            return jsonify({'error': 'File not found'}), 404
        return send_file(filepath, mimetype='audio/wav')
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/get-foley/<path:fname>')
def get_foley(fname):
    """Serve original foley file or any file inside the foley slices directories"""
    try:
        # sanitize filename (we'll search within FOLEY_FOLDER)
        target = None
        # direct path check
        direct = os.path.join(FOLEY_FOLDER, fname)
        if os.path.exists(direct):
            target = direct
        else:
            # search recursively for a file with matching basename
            for root, dirs, files in os.walk(FOLEY_FOLDER):
                for f in files:
                    if f == os.path.basename(fname):
                        candidate = os.path.join(root, f)
                        target = candidate
                        break
                if target:
                    break

        if not target or not os.path.exists(target):
            return jsonify({'error': 'File not found'}), 404

        return send_file(target, mimetype='audio/wav')
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/delete-foley', methods=['POST'])
def delete_foley():
    """Delete a foley file and its derived slices from the library.
    Expects JSON: { 'filename': 'name.wav' }
    """
    try:
        data = request.json
        if not data or 'filename' not in data:
            return jsonify({'success': False, 'error': 'filename required'}), 400
        filename = secure_filename(data['filename'])

        # load DB
        db = []
        if os.path.exists(FOLEY_DB):
            try:
                with open(FOLEY_DB, 'r', encoding='utf-8') as f:
                    db = json.load(f)
            except Exception:
                db = []

        # find entry
        entry = None
        for e in db:
            if e.get('filename') == filename:
                entry = e
                break

        # attempt to remove files
        removed = []
        # remove main file from FOLEY_FOLDER
        main_path = os.path.join(FOLEY_FOLDER, filename)
        if os.path.exists(main_path):
            try:
                os.remove(main_path)
                removed.append(main_path)
            except Exception:
                pass

        # remove slices dir if present in entry
        if entry and entry.get('slices_dir'):
            sd = entry.get('slices_dir')
            if os.path.exists(sd):
                try:
                    shutil.rmtree(sd)
                    removed.append(sd)
                except Exception:
                    pass

        # remove any matching slice files in FOLEY_FOLDER subdirs
        for root, dirs, files in os.walk(FOLEY_FOLDER):
            for f in files:
                if f == filename or f.startswith(Path(filename).stem + '_slice'):
                    try:
                        p = os.path.join(root, f)
                        os.remove(p)
                        removed.append(p)
                    except Exception:
                        pass

        # remove entry from db and write back
        new_db = [e for e in db if e.get('filename') != filename]
        try:
            with open(FOLEY_DB, 'w', encoding='utf-8') as f:
                json.dump(new_db, f, indent=2)
        except Exception:
            pass

        return jsonify({'success': True, 'removed': removed})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/enhance-slice', methods=['POST'])
def enhance_single_slice():
    try:
        data = request.json
        slice_path = data.get('slice_path')
        sound_type = data.get('sound_type', 'continuous')
        
        if not slice_path or not os.path.exists(slice_path):
            return jsonify({'success': False, 'error': 'Invalid slice path'}), 400
        
        # load audio files
        y, sr = load_audio(slice_path)
        
        # apply enhancement
        y_enhanced = apply_timbre_preset(y, sr, sound_type)
        
        # save enhanced version
        path_obj = Path(slice_path)
        enhanced_filename = f"{path_obj.stem}_enhanced{path_obj.suffix}"
        enhanced_path = str(path_obj.parent / enhanced_filename)
        sf.write(enhanced_path, y_enhanced, sr)
        
        return jsonify({
            'success': True,
            'enhanced_path': enhanced_path,
            'filename': enhanced_filename
        })
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/demo-files', methods=['GET'])
def get_demo_files():
    demo_files = [
        {'name': 'Knife on Glass', 'file': 'Knife_glass.wav'},
        {'name': 'Boiling Water', 'file': 'boilingWater.wav'},
        {'name': 'Wooden Comb', 'file': 'Wooden_comb_taps.wav'},
        {'name': 'Sloshing Water', 'file': 'Sloshing_water.wav'}
    ]
    return jsonify({'demo_files': demo_files})

if __name__ == '__main__':
    print("="*60)
    print("🎵 ENHANCED FOLEY FROM JUNK SERVER")
    print("="*60)
    print("Server: http://localhost:5001")
    print("Features:")
    print("  ✓ Video → Audio extraction")
    print("  ✓ Smart audio slicing (onset/silence)")
    print("  ✓ Feature analysis & clustering")
    print("  ✓ Timeline generation for UI")
    print("  ✓ Timbre enhancement & pitch variants")  
    print("="*60)
    app.run(debug=True, port=5001, host='0.0.0.0')