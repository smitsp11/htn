"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

export interface ToastProps {
  message: string;
  onDone: () => void;
}

export function Toast({ message, onDone }: ToastProps) {
  const [show, setShow] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setShow(false), 2600);
    return () => clearTimeout(timer);
  }, []);

  // onExitComplete fires onDone so the parent clears the toast only after the
  // exit animation has finished playing.
  return (
    <AnimatePresence onExitComplete={onDone}>
      {show && (
        <motion.div
          className="toast"
          role="status"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 18 }}
          transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
        >
          {message}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
