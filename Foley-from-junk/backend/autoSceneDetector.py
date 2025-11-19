import argparse
import os
import json
from pathlib import Path
import numpy as np
import librosa
import soundfile as sf
from moviepy.editor import VideoFileClip
from datetime import timedelta
from scipy.signal import find_peaks
from sklearn.cluster import KMeans


"""
# Basic usage (detect 3 activity types)
python autoSceneDetector.py --video cooking.mp4 --output scenes.json

# Detect 4 activity types
python autoSceneDetector.py --video cooking.mp4 --output scenes.json --scenes 4

# Adjust sensitivity (more sensitive = more scene changes)
python autoSceneDetector.py --video cooking.mp4 --output scenes.json --sensitivity 0.3

# Custom window size
python autoSceneDetector.py --video cooking.mp4 --output scenes.json --window 1.5

# Full customization
python autoSceneDetector.py --video cooking.mp4 --output scenes.json --scenes 5 --window 2.5 --sensitivity 0.7
"""

def extract_audio_from_video(video_path, output_audio='temp_audio.wav'):
    """Extract audio from video"""
    print(f"Extracting audio: {video_path}")
    try:
        video = VideoFileClip(video_path)
        audio = video.audio
        if audio is None:
            raise ValueError("Video has no audio track")
        audio.write_audiofile(output_audio, verbose=False, logger=None)
        video.close()
        return output_audio
    except Exception as e:
        print(f"Failed to extract audio: {e}")
        return None


def load_audio(path, sr=22050):
    """Load audio"""
    y, sr = librosa.load(path, sr=sr, mono=True)
    return y, sr


def compute_feature_timeline(y, sr, window_duration=2.0):
    """Compute audio feature timeline"""
    hop_length = 512
    window_samples = int(window_duration * sr)
    hop_samples = window_samples // 2
    
    times = []
    features_list = []
    
    print(f"Computing audio features (window: {window_duration} seconds)...")
    
    pos = 0
    while pos + window_samples < len(y):
        segment = y[pos:pos + window_samples]
        time = pos / sr
        
        features = {}
        
        # energy
        rms = np.sqrt(np.mean(segment**2))
        features['energy'] = rms
        
        # zero crossing rate
        zcr = np.mean(librosa.feature.zero_crossing_rate(segment))
        features['zcr'] = zcr
        
        # spectral centroid
        spec_cent = np.mean(librosa.feature.spectral_centroid(y=segment, sr=sr))
        features['spectral_centroid'] = spec_cent
        
        # spectral bandwidth
        spec_bw = np.mean(librosa.feature.spectral_bandwidth(y=segment, sr=sr))
        features['spectral_bandwidth'] = spec_bw
        
        # spectral contrast
        contrast = np.mean(librosa.feature.spectral_contrast(y=segment, sr=sr))
        features['spectral_contrast'] = contrast
        
        # mfcc
        mfcc = librosa.feature.mfcc(y=segment, sr=sr, n_mfcc=5)
        for i in range(5):
            features[f'mfcc_{i}'] = np.mean(mfcc[i])
        
        # rhythm intensity
        onset_strength = np.mean(librosa.onset.onset_strength(y=segment, sr=sr))
        features['onset_strength'] = onset_strength
        
        times.append(time)
        features_list.append(features)
        
        pos += hop_samples
    
    print(f"✓ Computed {len(times)} time windows\n")
    
    feature_names = list(features_list[0].keys())
    feature_matrix = np.array([[f[name] for name in feature_names] for f in features_list])
    
    return np.array(times), feature_matrix, feature_names, features_list


def detect_scene_changes(times, feature_matrix, sensitivity=1.0):
    """Detect feature change points"""
    print("Detecting scene change points...")
    
    # normalization
    feature_mean = np.mean(feature_matrix, axis=0)
    feature_std = np.std(feature_matrix, axis=0) + 1e-8
    feature_normalized = (feature_matrix - feature_mean) / feature_std
    
    # calculate distance between adjacent windows
    distances = []
    for i in range(1, len(feature_normalized)):
        dist = np.linalg.norm(feature_normalized[i] - feature_normalized[i-1])
        distances.append(dist)
    
    distances = np.array(distances)
    
    # find peaks
    threshold = np.mean(distances) + (sensitivity * np.std(distances))
    peaks, _ = find_peaks(distances, height=threshold, distance=3)
    
    change_points = []
    for peak in peaks:
        change_time = times[peak + 1]
        change_strength = distances[peak]
        change_points.append({
            'time': change_time,
            'strength': change_strength
        })
    
    print(f"✓ Detected {len(change_points)} scene change points\n")
    
    return change_points


def create_scenes_from_changes(change_points, duration):
    """Create scenes based on change points"""
    scenes = []
    start_time = 0.0
    
    for change in change_points:
        end_time = change['time']
        scenes.append({
            'start': start_time,
            'end': end_time,
            'duration': end_time - start_time
        })
        start_time = end_time
    
    scenes.append({
        'start': start_time,
        'end': duration,
        'duration': duration - start_time
    })
    
    return scenes


def analyze_scene_features(y, sr, scene, all_features, times):
    """Analyze average features of scene"""
    scene_start = scene['start']
    scene_end = scene['end']
    
    mask = (times >= scene_start) & (times < scene_end)
    scene_features = [f for f, m in zip(all_features, mask) if m]
    
    if len(scene_features) == 0:
        return None
    
    avg_features = {}
    feature_keys = scene_features[0].keys()
    
    for key in feature_keys:
        values = [f[key] for f in scene_features]
        avg_features[key] = float(np.mean(values))
    
    return avg_features


def cluster_scenes_by_similarity(scenes_with_features, n_clusters=3):
    """
    cluster scenes by similarity, automatic grouping
    """
    print(f"Clustering scenes into {n_clusters} groups...")
    
    if len(scenes_with_features) < n_clusters:
        n_clusters = len(scenes_with_features)
    
    # build feature matrix
    feature_names = ['energy', 'zcr', 'spectral_centroid', 'spectral_bandwidth', 
                    'onset_strength', 'spectral_contrast']
    
    X = []
    for scene in scenes_with_features:
        if scene['features']:
            feature_vector = [scene['features'].get(name, 0.0) for name in feature_names]
            X.append(feature_vector)
        else:
            X.append([0.0] * len(feature_names))
    
    X = np.array(X)
    
    # normalization
    X_mean = np.mean(X, axis=0)
    X_std = np.std(X, axis=0) + 1e-8
    X_normalized = (X - X_mean) / X_std
    
    # k-means clustering
    kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
    labels = kmeans.fit_predict(X_normalized)
    
    # add label to each cluster
    for scene, label in zip(scenes_with_features, labels):
        scene['activity_group'] = int(label)
    
    print(f"✓ Scenes clustered\n")
    
    return scenes_with_features


def describe_activity_group_simple(scenes_in_group):
    """Simple description of activity group characteristics"""
    if not scenes_in_group or not scenes_in_group[0].get('features'):
        return "Unknown"
    
    # calculate average features in group
    avg_features = {}
    feature_keys = scenes_in_group[0]['features'].keys()
    
    for key in feature_keys:
        values = []
        for scene in scenes_in_group:
            if scene.get('features') and key in scene['features']:
                values.append(scene['features'][key])
        if values:
            avg_features[key] = np.mean(values)
    
    energy = avg_features.get('energy', 0)
    onset = avg_features.get('onset_strength', 0)
    freq = avg_features.get('spectral_centroid', 0)
    
    # simple description
    desc_parts = []
    
    if onset > 1.5:
        desc_parts.append("Rhythmic")
    else:
        desc_parts.append("Continuous")
    
    if freq > 3500:
        desc_parts.append("High-freq")
    elif freq > 2000:
        desc_parts.append("Mid-freq")
    else:
        desc_parts.append("Low-freq")
    
    if energy > 0.08:
        desc_parts.append("Strong")
    elif energy > 0.04:
        desc_parts.append("Medium")
    else:
        desc_parts.append("Weak")
    
    return " | ".join(desc_parts)


def format_time(seconds):
    """Format time"""
    minutes = int(seconds // 60)
    secs = int(seconds % 60)
    millis = int((seconds % 1) * 1000)
    return f"{minutes:02d}:{secs:02d}.{millis:03d}"


def process_video(video_path, output_json, n_clusters=3, window_duration=2.0, sensitivity=1.0):
    """Main processing function"""
    print(f"\n{'='*70}")
    print(f"Automatic Scene Detection: {video_path}")
    print(f"{'='*70}\n")
    
    # 1. extract audio
    temp_audio = 'temp_auto_audio.wav'
    audio_path = extract_audio_from_video(video_path, temp_audio)
    if not audio_path:
        return False
    
    # 2. load audio
    print("Loading audio...")
    y, sr = load_audio(audio_path)
    duration = len(y) / sr
    print(f"✓ Duration: {duration:.2f} seconds\n")
    
    # 3. compute features
    times, feature_matrix, feature_names, all_features = compute_feature_timeline(
        y, sr, window_duration=window_duration
    )
    
    # 4. detect change points
    change_points = detect_scene_changes(times, feature_matrix, sensitivity=sensitivity)
    
    # 5. create scenes
    if len(change_points) == 0:
        print("⚠️  No scene changes detected, try lowering sensitivity: --sensitivity 0.5\n")
        scenes = [{'start': 0.0, 'end': duration, 'duration': duration}]
    else:
        scenes = create_scenes_from_changes(change_points, duration)
    
    print(f"Detected {len(scenes)} scene segments\n")
    
    # 6. analyze scene features
    print("Analyzing scene features...")
    scenes_with_features = []
    for i, scene in enumerate(scenes):
        features = analyze_scene_features(y, sr, scene, all_features, times)
        scene_info = {
            'scene_id': i + 1,
            'start': scene['start'],
            'end': scene['end'],
            'duration': scene['duration'],
            'features': features if features else {}
        }
        scenes_with_features.append(scene_info)
    print(f"✓ Analysis complete\n")
    
    # 7. clustering (group similar scenes)
    scenes_with_features = cluster_scenes_by_similarity(scenes_with_features, n_clusters=n_clusters)
    
    # 8. organize results by group
    groups = {}
    for scene in scenes_with_features:
        group_id = scene['activity_group']
        if group_id not in groups:
            groups[group_id] = []
        groups[group_id].append(scene)
    
    # 9. output results
    print("="*70)
    print(f"Detected {len(groups)} different types of activities:")
    print("="*70)
    
    result = {
        'video_path': video_path,
        'total_duration': float(duration),
        'num_activity_types': len(groups),
        'total_scenes': len(scenes_with_features),
        'activity_groups': {}
    }
    
    for group_id in sorted(groups.keys()):
        group_scenes = groups[group_id]
        description = describe_activity_group_simple(group_scenes)
        
        print(f"\n【Activity Type {group_id + 1}】 {description}")
        print(f"  Appears {len(group_scenes)} times")
        
        scene_times = []
        for scene in group_scenes:
            time_str = f"{format_time(scene['start'])} - {format_time(scene['end'])}"
            print(f"    • {time_str} ({scene['duration']:.1f} seconds)")
            scene_times.append({
                'start': scene['start'],
                'end': scene['end'],
                'duration': scene['duration'],
                'start_formatted': format_time(scene['start']),
                'end_formatted': format_time(scene['end'])
            })
        
        result['activity_groups'][str(group_id)] = {
            'description': description,
            'count': len(group_scenes),
            'scenes': scene_times
        }
    
    print(f"\n{'='*70}\n")
    
    # 10. save
    print(f"Saving results to: {output_json}")
    with open(output_json, 'w', encoding='utf-8') as f:
        json.dump(result, f, indent=2, ensure_ascii=False)
    print("✓ Save complete\n")
    
    # 11. cleanup
    try:
        if os.path.exists(temp_audio):
            os.remove(temp_audio)
    except:
        pass
    
    print("Scene detection complete!\n")
    return True


def main():
    parser = argparse.ArgumentParser(
        description="Automatic Scene Detection - Using clustering to automatically identify different activity types",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Example Usage:
  # detect 3 activity types (default)
  python autoSceneDetector.py --video cooking.mp4 --output scenes.json
  
  # detect 4 activity types
  python autoSceneDetector.py --video cooking.mp4 --output scenes.json --scenes 4
  
  # adjust sensitivity
  python autoSceneDetector.py --video cooking.mp4 --output scenes.json --sensitivity 0.7

How it Works:
  1. analyze audio features of entire video
  2. detect feature change points (scene transitions)
  3. automatically cluster similar scenes into same activity type
  4. output time segments for each activity

Output Example:
  【Activity Type 1】 Rhythmic | Mid-freq | Medium
    • 00:02.500 - 00:05.800 (3.3 seconds)
  
  【Activity Type 2】 Continuous | High-freq | Strong
    • 00:05.800 - 00:09.200 (3.4 seconds)
        """
    )
    
    parser.add_argument('--video', required=True, help='Input video file')
    parser.add_argument('--output', required=True, help='Output JSON file')
    parser.add_argument('--scenes', type=int, default=1,
                       help='Expected number of activity types to detect (default: 1)')
    parser.add_argument('--window', type=float, default=2.0,
                       help='Analysis window size in seconds (default: 2.0)')
    parser.add_argument('--sensitivity', type=float, default=1.0,
                       help='Detection sensitivity (default: 1.0, lower is more sensitive)')
    
    args = parser.parse_args()
    
    if not os.path.exists(args.video):
        print(f"Error: Video file does not exist: {args.video}")
        return
    
    success = process_video(
        video_path=args.video,
        output_json=args.output,
        n_clusters=args.scenes,
        window_duration=args.window,
        sensitivity=args.sensitivity
    )
    
    if success:
        print(f"Done! Results: {args.output}")


if __name__ == '__main__':
    main()