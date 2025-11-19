import argparse
import os
from pathlib import Path
import numpy as np
import librosa
import soundfile as sf
from sklearn.cluster import KMeans

# Utility to extract, analyze and slice audio files into foley samples.
# Usage examples:
#   python soundExtracting.py --input myfile.wav --outdir samples
#   python soundExtracting.py --input-folder ./recordings --outdir ./slices --min-duration 0.05



def find_audio_files(path):
    p = Path(path)
    if p.is_dir():
        exts = ('.wav', '.flac', '.mp3', '.m4a', '.ogg')
        return [f for f in p.rglob('*') if f.suffix.lower() in exts]
    elif p.is_file():
        return [p]
    else:
        return []

def load_audio(path, sr=None, mono=True):
    y, sr = librosa.load(path, sr=sr, mono=mono)
    return y, sr

def normalize_audio(y, peak=0.98):
    maxv = np.max(np.abs(y)) + 1e-9
    return (y / maxv) * peak

def fade_in_out(y, sr, fade_ms=10):
    n = len(y)
    fade_samples = int(sr * (fade_ms / 1000.0))
    if fade_samples <= 0:
        return y
    win = np.ones(n)
    fade_in = np.linspace(0.0, 1.0, fade_samples)
    fade_out = np.linspace(1.0, 0.0, fade_samples)
    win[:fade_samples] = fade_in
    win[-fade_samples:] = fade_out
    return y * win

def detect_slices_by_silence(y, sr, top_db=30, min_duration=0.03, merge_threshold=0.02):
    # returns list of (start_sample, end_sample)
    intervals = librosa.effects.split(y, top_db=top_db)
    # filter too short and merge with previous
    filtered = []
    min_len = int(min_duration * sr)
    merge_gap = int(merge_threshold * sr)
    for s, e in intervals:
        if e - s >= min_len:
            if filtered and s - filtered[-1][1] <= merge_gap:
                filtered[-1] = (filtered[-1][0], e)
            else:
                filtered.append((s, e))
    return filtered

def detect_onset_slices(y, sr, hop_length=512, backtrack=True, min_duration=0.02):
    onsets = librosa.onset.onset_detect(y=y, sr=sr, hop_length=hop_length, backtrack=backtrack)
    frames = librosa.frames_to_samples(onsets, hop_length=hop_length)
    frames = np.unique(np.concatenate(([0], frames, [len(y)])))
    # build intervals between frames, filter short
    min_len = int(min_duration * sr)
    intervals = []
    for i in range(len(frames)-1):
        s, e = frames[i], frames[i+1]
        if e - s >= min_len:
            intervals.append((s, e))
    return intervals

def analyze_slice(y, sr):
    # simple feature vector: RMS, ZCR, spectral centroid, mfcc mean (first 3)
    rms = float(np.mean(librosa.feature.rms(y=y)))
    zcr = float(np.mean(librosa.feature.zero_crossing_rate(y)))
    spec_cent = float(np.mean(librosa.feature.spectral_centroid(y=y, sr=sr)))
    mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=6)
    mfcc_mean = [float(np.mean(mfcc[i])) for i in range(min(3, mfcc.shape[0]))]
    return {
        'rms': rms,
        'zcr': zcr,
        'spec_cent': spec_cent,
        'mfcc1': mfcc_mean[0] if len(mfcc_mean) > 0 else 0.0,
        'mfcc2': mfcc_mean[1] if len(mfcc_mean) > 1 else 0.0,
        'mfcc3': mfcc_mean[2] if len(mfcc_mean) > 2 else 0.0
    }

def save_slice(y, sr, outdir, base_name, idx, fmt='wav', normalize=True, fade_ms=6):
    if normalize:
        y = normalize_audio(y)
    if fade_ms and sr:
        y = fade_in_out(y, sr, fade_ms=fade_ms)
    outdir = Path(outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    out_path = outdir / f"{base_name}_slice{idx:03d}.{fmt}"
    sf.write(str(out_path), y, sr)
    return out_path

def cluster_and_mix(slice_features, slice_paths, n_clusters=4, mixes_per_cluster=3, outdir='mixes', sr_override=None):
    # slice_features: list of feature dicts
    X = np.array([[f['rms'], f['zcr'], f['spec_cent'], f['mfcc1'], f['mfcc2'], f['mfcc3']] for f in slice_features])
    if len(X) < n_clusters:
        n_clusters = max(1, len(X))
    kmeans = KMeans(n_clusters=n_clusters, random_state=0).fit(X)
    clusters = {}
    for i, label in enumerate(kmeans.labels_):
        clusters.setdefault(label, []).append(i)
    outdir = Path(outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    mixes = []
    for label, idxs in clusters.items():
        for mixi in range(mixes_per_cluster):
            # random short concatenation from the cluster
            chosen = np.random.choice(idxs, size=min(4, len(idxs)), replace=False)
            pieces = []
            for c in chosen:
                y, sr = load_audio(slice_paths[c])
                if sr_override:
                    sr = sr_override
                pieces.append(y)
            mixed = np.concatenate(pieces)
            mixed = normalize_audio(mixed)
            out_path = outdir / f"cluster{label}_mix{mixi:02d}.wav"
            sf.write(str(out_path), mixed, sr)
            mixes.append(out_path)
    return mixes

def process_file(path, outdir, method='silence', top_db=30, min_duration=0.03, analyze=True):
    y, sr = load_audio(path)
    base = Path(path).stem
    if method == 'silence':
        intervals = detect_slices_by_silence(y, sr, top_db=top_db, min_duration=min_duration)
    elif method == 'onset':
        intervals = detect_onset_slices(y, sr, min_duration=min_duration)
    else:
        intervals = [(0, len(y))]
    slice_paths = []
    features = []
    for i, (s, e) in enumerate(intervals):
        ys = y[s:e]
        p = save_slice(ys, sr, outdir, base, i)
        slice_paths.append(str(p))
        if analyze:
            features.append(analyze_slice(ys, sr))
    return slice_paths, features

def main():
    parser = argparse.ArgumentParser(description="Extract and slice audio into foley samples")
    parser.add_argument('--input', help='input file or folder', required=True)
    parser.add_argument('--outdir', help='output directory', default='slices')
    parser.add_argument('--method', choices=['silence', 'onset', 'whole'], default='silence')
    parser.add_argument('--top-db', type=float, default=30.0)
    parser.add_argument('--min-duration', type=float, default=0.03)
    parser.add_argument('--cluster-mix', action='store_true', help='cluster slices and make mixes')
    parser.add_argument('--clusters', type=int, default=4)
    args = parser.parse_args()

    files = find_audio_files(args.input)
    all_slice_paths = []
    all_features = []
    for f in files:
        print("Processing:", f)
        paths, feats = process_file(f, args.outdir, method=args.method, top_db=args.top_db, min_duration=args.min_duration)
        all_slice_paths.extend(paths)
        all_features.extend(feats)

    if args.cluster_mix and all_features:
        print("Clustering and creating mixes...")
        mixes = cluster_and_mix(all_features, all_slice_paths, n_clusters=args.clusters, outdir=Path(args.outdir) / 'mixes')
        print("Created mixes:", mixes)

if __name__ == '__main__':
    main()