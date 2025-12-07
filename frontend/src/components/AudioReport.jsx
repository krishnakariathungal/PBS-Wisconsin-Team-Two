import React, { useRef } from "react";

const AudioReport = ({ file, waveform, log, onPlay, onDownload }) => {
    const audioRef = useRef(null);

    return (
        <div style={{ border: "1px solid #ccc", padding: "16px", marginBottom: "16px", borderRadius: "8px", background: "#f9f9f9" }}>
            <h3>{file.name}</h3>
            {/* Waveform visualization placeholder */}
            <div style={{ height: "80px", background: "#e0e0e0", margin: "8px 0" }}>
                {waveform || "[Waveform visualization here]"}
            </div>
            {/* Log display */}
            {log && (
                <pre style={{ background: "#fff", padding: "8px", borderRadius: "4px", marginBottom: "8px" }}>{log}</pre>
            )}
            {/* Play and Download buttons */}
            <audio ref={audioRef} src={URL.createObjectURL(file)} style={{ display: "none" }} />
            <button onClick={() => onPlay(audioRef.current)} style={{ marginRight: "8px" }}>Play</button>
            <button onClick={() => onDownload(file)}>Download</button>
        </div>
    );
};

export default AudioReport;
