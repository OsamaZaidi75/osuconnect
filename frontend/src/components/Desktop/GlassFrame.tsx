import React from "react";
import { Box } from "@mui/material";
import { useTheme } from "@mui/material/styles";

/**
 * In the glass theme the desktop app floats over the wallpaper in a rounded,
 * translucent frame. The `transform` makes the frame the containing block for
 * everything inside it (the rail, content area and voice bar are
 * fixed/absolute), so they position within the frame with no changes of their
 * own. Small windows get no margin, so nothing is wasted on them.
 */
export const GlassFrame: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const theme = useTheme();
  if (!theme.glass) return <>{children}</>;

  return (
    <Box
      data-testid="glass-frame"
      sx={{
        position: "fixed",
        inset: 0,
        overflow: "hidden",
        transform: "translateZ(0)",
        backgroundColor: "rgba(0, 0, 0, 0.27)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        "@media (min-width: 1100px) and (min-height: 700px)": {
          inset: 24,
          borderRadius: "12px",
          border: "1px solid rgba(255, 255, 255, 0.1)",
          boxShadow: "0 20px 60px rgba(0, 0, 0, 0.5)",
        },
      }}
    >
      {children}
    </Box>
  );
};

export default GlassFrame;
