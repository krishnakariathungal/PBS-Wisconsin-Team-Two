import { useNavigate } from "react-router-dom";

export default function HomeButton() {
  const navigate = useNavigate();

  return (
    <button
      onClick={() => navigate("/")}
      style={{
        position: "fixed",
        top: "24px",
        left: "32px",
        background: "white",
        borderRadius: "10px",
        border: "1px solid rgba(128, 90, 213, 0.2)",
        padding: "10px 12px",
        cursor: "pointer",
        boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
        transition: "all 0.2s ease",
        zIndex: 1000,

        /* REMOVE default focus highlight */
        outline: "none",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = "0 6px 18px rgba(128, 90, 213, 0.25)";
        e.currentTarget.style.transform = "translateY(-2px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.08)";
        e.currentTarget.style.transform = "translateY(0)";
      }}

      /* ALSO remove blue outline on click/focus */
      onFocus={(e) => {
        e.currentTarget.style.outline = "none";
        e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.08)";
      }}
      onMouseDown={(e) => {
        e.currentTarget.style.outline = "none";
      }}
    >
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#7c3aed"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 10.5L12 4l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1V10.5z" />
      </svg>
    </button>
  );
}
