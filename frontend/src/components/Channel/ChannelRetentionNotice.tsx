import React from "react";
import { Box, Typography } from "@mui/material";
import TimerOutlinedIcon from "@mui/icons-material/TimerOutlined";
import { describeChannelRetention, type ChannelRetention } from "../../utils/channelRetention";

interface ChannelRetentionNoticeProps {
  channel?: ChannelRetention | null;
}

/** Greyed note under the channel header telling people how long this channel's content is kept. */
const ChannelRetentionNotice: React.FC<ChannelRetentionNoticeProps> = ({ channel }) => {
  const text = describeChannelRetention(channel);
  if (!text) return null;

  return (
    <Box
      role="note"
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.75,
        px: 2,
        py: 0.5,
        borderBottom: 1,
        borderColor: "divider",
        color: "text.secondary",
      }}
    >
      <TimerOutlinedIcon aria-hidden sx={{ fontSize: "icon.sm", flexShrink: 0 }} />
      <Typography variant="caption" color="inherit">
        {text}
      </Typography>
    </Box>
  );
};

export default ChannelRetentionNotice;
