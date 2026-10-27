import { useRef, useState } from "react";
import Webcam from "react-webcam";
import { addPhoto } from "../db";

function WebcamCapture({ taskId, onClose }) {
  const webcamRef = useRef(null);
  const [photo, setPhoto] = useState(null);
  const [error, setError] = useState("");

  function takePhoto() {
    const image = webcamRef.current?.getScreenshot();

    if (image) {
      setPhoto(image);
    } else {
      setError("Could not capture a photo.");
    }
  }

  async function savePhoto() {
    if (!photo) return;

    try {
      await addPhoto(taskId, photo);
      onClose();
    } catch (err) {
      console.error("Photo saving failed:", err);
      setError("Could not save the photo.");
    }
  }

  return (
    <div className="stack-small">
      <h3>Take a photo</h3>

      {!photo ? (
        <Webcam
          audio={false}
          ref={webcamRef}
          screenshotFormat="image/jpeg"
          screenshotQuality={0.7}
          width="100%"
          videoConstraints={{ facingMode: "environment" }}
          onUserMediaError={() =>
            setError("Camera access denied or unavailable.")
          }
        />
      ) : (
        <img src={photo} alt="Captured preview" width="100%" />
      )}

      {error && <p role="alert">{error}</p>}

      <div className="btn-group">
        {!photo ? (
          <button type="button" onClick={takePhoto}>
            Capture
          </button>
        ) : (
          <>
            <button type="button" onClick={() => setPhoto(null)}>
              Retake
            </button>
            <button type="button" onClick={savePhoto}>
              Save Photo
            </button>
          </>
        )}

        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export default WebcamCapture;