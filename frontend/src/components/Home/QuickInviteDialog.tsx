import React, { useEffect, useRef, useState } from "react";
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Snackbar,
  Typography,
} from "@mui/material";
import { ContentCopy as CopyIcon, Link as LinkIcon } from "@mui/icons-material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link as RouterLink } from "react-router-dom";
import {
  communityControllerFindAllMineOptions,
  inviteControllerCreateInviteMutation,
} from "../../api-client/@tanstack/react-query.gen";
import { copyToClipboard } from "../../utils/clipboard";
import { getInstanceUrl } from "../../config/env";
import { invalidateInviteQueries } from "../../utils/queryInvalidation";
import {
  buildQuickInviteBody,
  inviteUrl,
  QUICK_INVITE_MAX_USES,
  QUICK_INVITE_TTL_MS,
} from "../../utils/quickInvite";
import { logger } from "../../utils/logger";

interface QuickInviteDialogProps {
  open: boolean;
  onClose: () => void;
}

/** Creates a short invite code as soon as it opens, and shows it with copy buttons. */
const QuickInviteDialog: React.FC<QuickInviteDialogProps> = ({ open, onClose }) => {
  const queryClient = useQueryClient();
  const { data: rawCommunities } = useQuery({ ...communityControllerFindAllMineOptions(), enabled: open });
  const [code, setCode] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [snackbar, setSnackbar] = useState<string | null>(null);
  const requested = useRef(false);

  const { mutateAsync: createInvite, isPending } = useMutation({
    ...inviteControllerCreateInviteMutation(),
    onSuccess: () => invalidateInviteQueries(queryClient),
  });

  const generate = async () => {
    setFailed(false);
    try {
      const communities = (rawCommunities ?? []).filter((c) => c != null);
      const invite = await createInvite({ body: buildQuickInviteBody(communities) });
      setCode(invite.code);
    } catch (error) {
      logger.error("Failed to create invite:", error);
      setFailed(true);
    }
  };

  useEffect(() => {
    if (!open) {
      requested.current = false;
      setCode(null);
      setFailed(false);
      return;
    }
    if (rawCommunities && !requested.current) {
      requested.current = true;
      void generate();
    }
    // generate only depends on the loaded communities when the dialog opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rawCommunities]);

  const copy = async (text: string, message: string) => {
    try {
      await copyToClipboard(text);
      setSnackbar(message);
    } catch (error) {
      logger.error("Failed to copy invite:", error);
      setSnackbar("Couldn't copy. Select it and copy manually.");
    }
  };

  const hours = Math.round(QUICK_INVITE_TTL_MS / 3600000);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Invite a friend</DialogTitle>
      <DialogContent>
        <Box sx={{ textAlign: "center", py: 1 }}>
          {isPending || (!code && !failed) ? (
            <CircularProgress aria-label="Creating invite" />
          ) : failed ? (
            <Typography color="error">Couldn't create an invite. Try again.</Typography>
          ) : (
            <>
              <Typography
                variant="h2"
                data-testid="quick-invite-code"
                sx={{ fontFamily: "monospace", fontWeight: 700, letterSpacing: "0.2em", pl: "0.2em" }}
              >
                {code}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                On the sign-up page choose Register and enter this code. Valid for {hours} hours,{" "}
                {QUICK_INVITE_MAX_USES} uses.
              </Typography>
            </>
          )}
        </Box>
      </DialogContent>
      <DialogActions sx={{ flexWrap: "wrap", gap: 1, px: 3, pb: 2 }}>
        <Button component={RouterLink} to="/admin/invites" onClick={onClose} size="small">
          Manage
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button onClick={() => void generate()} disabled={isPending} size="small">
          New code
        </Button>
        <Button
          startIcon={<CopyIcon />}
          disabled={!code}
          onClick={() => code && copy(code, "Code copied!")}
          size="small"
        >
          Copy code
        </Button>
        <Button
          variant="contained"
          startIcon={<LinkIcon />}
          disabled={!code}
          onClick={() => code && copy(inviteUrl(getInstanceUrl(), code), "Invite link copied!")}
          size="small"
        >
          Copy link
        </Button>
      </DialogActions>
      <Snackbar open={snackbar !== null} autoHideDuration={2500} onClose={() => setSnackbar(null)} message={snackbar} />
    </Dialog>
  );
};

export default QuickInviteDialog;
