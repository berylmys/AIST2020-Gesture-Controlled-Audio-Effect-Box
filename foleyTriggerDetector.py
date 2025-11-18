# foleyTriggerDetector.py
# Detects foley sound trigger times in audio and groups them by sound pattern

'''
# default fast mode (16kHz)
python foleyTriggerDetector.py --input rawSound/Knife_glass.wav

# high quality mode (22kHz)
python foleyTriggerDetector.py --input rawSound/Knife_glass.wav --high-quality

# JSON only, don't generate fragment audos (fastest)
python foleyTriggerDetector.py --input rawSound/boilingWater.wav --no-export
'''
import argparse
import json
from pathlib import Path
import numpy as np
import librosa
import soundfile as sf
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler

def load_audio(path, sr=16000, mono=True):
    """load audio file - using 16kHz for speed"""
    y, sr = librosa.load(path, sr=sr, mono=mono)
    return y, sr

def detect_foley_triggers(y, sr, method='onset', sensitivity=0.5):
    """
    detect foley sound trigger times
    returns: list of trigger times in seconds
    """
    if method == 'onset':
        hop_length = 256  # 256 for faster processing
        onset_frames = librosa.onset.onset_detect(
            y=y, 
            sr=sr, 
            hop_length=hop_length,
            backtrack=True,
            units='frames'
        )
        trigger_times = librosa.frames_to_time(onset_frames, sr=sr, hop_length=hop_length)
        
    elif method == 'energy':
        # energy-based detect
        frame_length = 1024 
        hop_length = 256     
        
        # calculate RMS energy
        rms = librosa.feature.rms(y=y, frame_length=frame_length, hop_length=hop_length)[0]
        # adaptive threshold based on sensitivity
        threshold = np.percentile(rms, (1 - sensitivity) * 100)
        # find frames above threshold
        trigger_frames = np.where(rms > threshold)[0]
        
        # group consecutive frames and take first frame of each group
        # if frames [10, 11, 12, 13] > threshold, only retain trigger frame 10
        if len(trigger_frames) > 0:
            gaps = np.diff(trigger_frames) > 1
            group_starts = np.concatenate(([0], np.where(gaps)[0] + 1))
            trigger_frames = trigger_frames[group_starts]
        
        trigger_times = librosa.frames_to_time(trigger_frames, sr=sr, hop_length=hop_length)

    else:
        raise ValueError(f"Unknown method: {method}")
    
    return trigger_times

def extract_trigger_segment(y, sr, trigger_time, window_size=0.5):
    """
    extract audio segment around trigger time
    win_size: duration in secs to extract after trigger
    """
    start_sample = int(trigger_time * sr)
    end_sample = int((trigger_time + window_size) * sr)
    end_sample = min(end_sample, len(y))
    
    if start_sample >= len(y):
        return np.array([])
    
    segment = y[start_sample:end_sample]
    return segment

def analyze_trigger_features(segment, sr):
    if len(segment) < 256: 
        # too short, return zeros
        return {
            'rms': 0.0,
            'zcr': 0.0,
            'spec_cent': 0.0,
            'spec_bw': 0.0,
            'mfcc1': 0.0,
            'mfcc2': 0.0,
            'mfcc3': 0.0,
            'duration': 0.0
        }
    
    # time-domain features
    rms = float(np.mean(librosa.feature.rms(y=segment)))
    zcr = float(np.mean(librosa.feature.zero_crossing_rate(segment)))
    
    # spectral features
    hop_length = 256  
    spec_cent = float(np.mean(librosa.feature.spectral_centroid(y=segment, sr=sr, hop_length=hop_length)))
    spec_bw = float(np.mean(librosa.feature.spectral_bandwidth(y=segment, sr=sr, hop_length=hop_length)))
    
    # MFCC features
    mfcc = librosa.feature.mfcc(y=segment, sr=sr, n_mfcc=4, hop_length=hop_length)
    mfcc_mean = [float(np.mean(mfcc[i])) for i in range(min(3, mfcc.shape[0]))]
    
    duration = len(segment) / sr
    
    return {
        'rms': rms,
        'zcr': zcr,
        'spec_cent': spec_cent,
        'spec_bw': spec_bw,
        'mfcc1': mfcc_mean[0] if len(mfcc_mean) > 0 else 0.0,
        'mfcc2': mfcc_mean[1] if len(mfcc_mean) > 1 else 0.0,
        'mfcc3': mfcc_mean[2] if len(mfcc_mean) > 2 else 0.0,
        'duration': duration
    }

def group_triggers_by_pattern(trigger_data, n_groups=4):
    """
    sound pattern clustering
    trigger_data: list of dicts with 'time' and 'features'
    returns: list of dicts with 'time', 'features', and 'group'
    """
    if len(trigger_data) < n_groups:
        n_groups = max(1, len(trigger_data))
    
    # feature vectors list
    feature_keys = ['rms', 'zcr', 'spec_cent', 'spec_bw', 'mfcc1', 'mfcc2', 'mfcc3']
    X = np.array([[t['features'][k] for k in feature_keys] for t in trigger_data])
    
    # std features
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)
    
    # KMeans clustering
    kmeans = KMeans(n_clusters=n_groups, random_state=42, n_init=5, max_iter=100)
    labels = kmeans.fit_predict(X_scaled)

    for i, label in enumerate(labels):
        trigger_data[i]['group'] = int(label)
        trigger_data[i]['group_name'] = f"pattern_{label}"
    
    return trigger_data

def analyze_group_statistics(trigger_data):
    """
    calculate stats for each group
    """
    groups = {}
    for trigger in trigger_data:
        group_id = trigger['group']
        if group_id not in groups:
            groups[group_id] = {
                'group_id': group_id,
                'group_name': trigger['group_name'],
                'count': 0,
                'avg_rms': 0.0,
                'avg_duration': 0.0,
                'trigger_times': []
            }
        
        groups[group_id]['count'] += 1
        groups[group_id]['avg_rms'] += trigger['features']['rms']
        groups[group_id]['avg_duration'] += trigger['features']['duration']
        groups[group_id]['trigger_times'].append(trigger['time'])
    
    # calculate avg
    for group_id in groups:
        count = groups[group_id]['count']
        groups[group_id]['avg_rms'] /= count
        groups[group_id]['avg_duration'] /= count
    
    return groups

def export_trigger_segments(y, sr, trigger_data, outdir, base_name):
    """
    export individual trigger segments grouped by pattern
    """
    outdir = Path(outdir)
    
    for trigger in trigger_data:
        group_name = trigger['group_name']
        group_dir = outdir / group_name
        group_dir.mkdir(parents=True, exist_ok=True)
        
        # extract segment
        segment = extract_trigger_segment(y, sr, trigger['time'], window_size=0.5)
        
        if len(segment) > 0:
            max_val = np.max(np.abs(segment)) + 1e-9
            segment = (segment / max_val) * 0.95
            
            filename = f"{base_name}_t{trigger['time']:.3f}s.wav"
            filepath = group_dir / filename
            sf.write(str(filepath), segment, sr)

def process_audio_file(input_path, outdir='foley_triggers', method='onset', 
                      n_groups=4, sensitivity=0.5, window_size=0.5, 
                      export_segments=True, fast_mode=True):
    """
    main processing function 
    """
    print(f"Processing: {input_path}")
    
    # load audio with lower sample rate for speed
    sr = 16000 if fast_mode else 22050
    y, sr = load_audio(input_path, sr=sr)
    base_name = Path(input_path).stem
    
    # detect triggers
    print(f"Detecting triggers using method: {method}")
    trigger_times = detect_foley_triggers(y, sr, method=method, sensitivity=sensitivity)
    print(f"Found {len(trigger_times)} triggers")
    
    if len(trigger_times) == 0:
        print("No triggers detected!")
        return None

    print("Analyzing trigger features...")
    trigger_data = []
    for time in trigger_times:
        segment = extract_trigger_segment(y, sr, time, window_size=window_size)
        features = analyze_trigger_features(segment, sr)
        trigger_data.append({
            'time': float(time),
            'features': features
        })
    
    # group by pattern
    print(f"Grouping into {n_groups} patterns...")
    trigger_data = group_triggers_by_pattern(trigger_data, n_groups=n_groups)
    
    # calculate group stats
    group_stats = analyze_group_statistics(trigger_data)
    outdir = Path(outdir) / base_name
    outdir.mkdir(parents=True, exist_ok=True)

    # JSON
    result = {
        'input_file': str(input_path),
        'sample_rate': sr,
        'duration': float(len(y) / sr),
        'total_triggers': len(trigger_data),
        'n_groups': n_groups,
        'detection_method': method,
        'group_statistics': {str(k): v for k, v in group_stats.items()},
        'triggers': trigger_data
    }
    
    json_path = outdir / f"{base_name}_triggers.json"
    with open(json_path, 'w') as f:
        json.dump(result, f, indent=2)
    print(f"Saved trigger data to: {json_path}")
    
    # export trigger segments
    if export_segments:
        print("Exporting trigger segments...")
        segments_dir = outdir / 'segments'
        export_trigger_segments(y, sr, trigger_data, segments_dir, base_name)
        print(f"Saved segments to: {segments_dir}")
    
    return result

def main():
    parser = argparse.ArgumentParser(
        description="Detect foley sound trigger times and group by pattern"
    )
    parser.add_argument('--input', required=True, 
                       help='Input WAV file path')
    parser.add_argument('--outdir', default='foley_triggers',
                       help='Output directory (default: foley_triggers)')
    parser.add_argument('--method', choices=['onset', 'energy'], default='onset',
                       help='Detection method (default: onset)')
    parser.add_argument('--groups', type=int, default=4,
                       help='Number of pattern groups (default: 4)')
    parser.add_argument('--sensitivity', type=float, default=0.5,
                       help='Detection sensitivity 0-1 (default: 0.5)')
    parser.add_argument('--window', type=float, default=0.5,
                       help='Trigger window size in seconds (default: 0.5)')
    parser.add_argument('--no-export', action='store_true',
                       help='Do not export trigger segments')
    parser.add_argument('--high-quality', action='store_true',
                       help='Use higher sample rate (slower but better quality)')
    
    args = parser.parse_args()
    
    # validate input
    if not Path(args.input).exists():
        print(f"Error: Input file not found: {args.input}")
        return
    
    # process
    result = process_audio_file(
        input_path=args.input,
        outdir=args.outdir,
        method=args.method,
        n_groups=args.groups,
        sensitivity=args.sensitivity,
        window_size=args.window,
        export_segments=not args.no_export,
        fast_mode=not args.high_quality
    )
    
    if result:
        print(f"\n✓ Detection complete!")
        print(f"  Total triggers: {result['total_triggers']}")
        print(f"  Grouped into: {result['n_groups']} patterns")
        print(f"  Sample rate: {result['sample_rate']} Hz")
        print("\nGroup statistics:")
        for group_id, stats in result['group_statistics'].items():
            print(f"  {stats['group_name']}: {stats['count']} triggers, "
                  f"avg RMS: {stats['avg_rms']:.4f}, "
                  f"avg duration: {stats['avg_duration']:.3f}s")

if __name__ == '__main__':
    main()