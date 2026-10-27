import { usePhotoSrc } from "../db";

function ViewPhoto({ taskId, onClose }) {
  const photoSrc = usePhotoSrc(taskId);

  return (
    <div className="stack-small">
      <h3>Task Photo</h3>

      {photoSrc ? (
        <img
          src={photoSrc}
          alt="Photo attached to task"
          style={{ width: "100%", maxWidth: "500px" }}
        />
      ) : (
        <p>No photo saved for this task yet.</p>
      )}

      <button type="button" onClick={onClose}>
        Close
      </button>
    </div>
  );
}

export default ViewPhoto;