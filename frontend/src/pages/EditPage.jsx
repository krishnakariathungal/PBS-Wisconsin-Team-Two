// pages/EditPage.jsx
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import "./EditPage.css";
import HomeButton from "../components/HomeButton";
import AudioFileEditor from "../components/AudioFileEditor";

export default function EditPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [files, setFiles] = useState([]);

  useEffect(() => {
    const passedFiles = location.state?.files;

    if (!passedFiles || passedFiles.length === 0) {
      navigate('/');
      return;
    }

    setFiles(passedFiles);
  }, [location, navigate]);

  const handleRemoveFile = (index) => {
    const newFiles = files.filter((_, i) => i !== index);
    if (newFiles.length === 0) {
      navigate('/');
    } else {
      setFiles(newFiles);
    }
  };

  if (files.length === 0) {
    return (
      <div className="edit-page">
        <HomeButton />
        <header className="edit-header">
          <h1 className="edit-title">Loading...</h1>
        </header>
      </div>
    );
  }

  return (
    <div className="edit-page">
      <HomeButton />

      {/* Header with Audio Editor title */}
      <header className="edit-header">
        <h1 className="edit-title">Audio Editor</h1>
      </header>

      {/* Files container */}
      <div className="files-container">
        {files.map((file, index) => (
          <div key={index} className="file-editor-wrapper">
            <AudioFileEditor
              file={file}
              onRemove={() => handleRemoveFile(index)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
