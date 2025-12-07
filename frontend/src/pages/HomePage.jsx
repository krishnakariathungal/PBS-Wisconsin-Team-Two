// pages/HomePage.jsx
import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import "./HomePage.css";
import HomeButton from "../components/HomeButton";

export default function HomePage() {
  const [selectedFile, setSelectedFile] = useState(null);
  const fileInputRef = useRef(null);
  const navigate = useNavigate();

  const handleFileSelect = (event) => {
    const file = event.target.files[0];
    if (file && file.type.startsWith('audio/')) {
      setSelectedFile(file);
    } else {
      alert('Please select an audio file');
    }
  };

  const handleDrop = (event) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file && file.type.startsWith('audio/')) {
      setSelectedFile(file);
    } else {
      alert('Please select an audio file');
    }
  };

  const handleDragOver = (event) => {
    event.preventDefault();
  };

  const handleBrowseClick = () => {
    fileInputRef.current.click();
  };

  const handleUpload = () => {
    if (selectedFile) {
      // Navigate to editing page with the file
      navigate('/edit', { state: { file: selectedFile } });
    } else {
      alert('Please select a file first');
    }
  };

  return (
    <div className="home-main">
      <HomeButton/>

      {/* Heading */}
      <header className="heading-upload">
        <h1 className="heading-text">Upload</h1>
      </header>

      {/* Upload file area */}
      <section className="upload-file-area" aria-labelledby="upload-title">
        <h2 id="upload-title" className="sr-only">
          Upload file area
        </h2>

        <div
          className="upload-file-background"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
        >
          <div className="upload-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="56" height="56" fill="none" aria-hidden="true">
              <path
                d="M7 18a5 5 0 010-10 6 6 0 0111.31 1.5A4 4 0 1118 18H7z"
                stroke="currentColor"
                strokeWidth="1.7"
              />
              <path
                d="M12 8v7m0 0l-3-3m3 3l3-3"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>

          <div className="drag-drop-line">
            <p className="drag-drop-text">
              <strong>Drag &amp; drop files</strong>&nbsp;or&nbsp;
              <span className="browse" onClick={handleBrowseClick}>
                Browse
              </span>
            </p>
          </div>

          <div className="supported-formats-line">
            <p className="supported-formats-text">
              Supported formats: MP3, WAV, OGG, AAC
            </p>
          </div>

          {selectedFile && (
            <div className="selected-file">
              <p>Selected: {selectedFile.name}</p>
            </div>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />
      </section>

      {/* CTA */}
      <div className="cta">
        <button
          className="cta-button"
          type="button"
          onClick={handleUpload}
        >
          <span className="label">Upload Files</span>
        </button>
      </div>
    </div>
  );
}