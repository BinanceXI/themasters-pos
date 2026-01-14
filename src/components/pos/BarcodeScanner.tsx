import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Camera, Flashlight, FlashlightOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useZxing } from "react-zxing"; 
import { toast } from 'sonner';

interface BarcodeScannerProps {
  isOpen: boolean;
  onClose: () => void;
  onScan: (barcode: string) => void;
}

export const BarcodeScanner = ({ isOpen, onClose, onScan }: BarcodeScannerProps) => {
  const [flashOn, setFlashOn] = useState(false);
  const [lastScanned, setLastScanned] = useState<string>('');

  const { ref } = useZxing({
    onDecodeResult(result) {
      const code = result.getText();
      
      if (code === lastScanned) return; 
      
      setLastScanned(code);
      
      // Play a "Beep" sound if available
      try {
        const audio = new Audio('/beep.mp3');
        audio.play().catch(() => {});
      } catch (e) {}

      onScan(code);
    },
    // ✅ FIX IS HERE: Added ': any' to prevent the red line
    onError(error: any) {
      if (error?.name === 'NotAllowedError') {
        toast.error("Camera access denied. Please allow camera permissions.");
      }
    },
    constraints: {
      video: {
        facingMode: 'environment', 
        width: { ideal: 1280 },
        height: { ideal: 720 },
        // @ts-ignore
        advanced: [{ torch: flashOn }] 
      }
    }
  });

  const toggleFlash = async () => {
    setFlashOn(!flashOn);
  };

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md p-0 overflow-hidden bg-black border-slate-800">
        <DialogHeader className="p-4 pb-2 bg-slate-900/80 backdrop-blur-sm absolute top-0 left-0 right-0 z-10">
          <DialogTitle className="flex items-center gap-2 text-white">
            <Camera className="w-5 h-5" />
            Scan Product
          </DialogTitle>
        </DialogHeader>
        
        <div className="relative aspect-[4/3] bg-black overflow-hidden">
          <video
            ref={ref}
            className="w-full h-full object-cover"
          />
          
          {/* SCANNING OVERLAY */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="relative w-64 h-40 border-2 border-white/50 rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]">
              {/* Corner Markers */}
              <div className="absolute -top-0.5 -left-0.5 w-6 h-6 border-t-4 border-l-4 border-blue-500 rounded-tl-lg" />
              <div className="absolute -top-0.5 -right-0.5 w-6 h-6 border-t-4 border-r-4 border-blue-500 rounded-tr-lg" />
              <div className="absolute -bottom-0.5 -left-0.5 w-6 h-6 border-b-4 border-l-4 border-blue-500 rounded-bl-lg" />
              <div className="absolute -bottom-0.5 -right-0.5 w-6 h-6 border-b-4 border-r-4 border-blue-500 rounded-br-lg" />

              {/* Laser Line */}
              <AnimatePresence>
                <motion.div
                  initial={{ top: "10%", opacity: 0 }}
                  animate={{ top: ["10%", "90%", "10%"], opacity: 1 }}
                  transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                  className="absolute left-2 right-2 h-0.5 bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.8)]"
                />
              </AnimatePresence>
            </div>
          </div>

          {/* Flashlight Control */}
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20">
            <Button
              variant="outline"
              size="icon"
              onClick={toggleFlash}
              className="rounded-full h-12 w-12 bg-white/10 border-white/20 hover:bg-white/20 text-white backdrop-blur-md"
            >
              {flashOn ? <FlashlightOff className="w-6 h-6" /> : <Flashlight className="w-6 h-6" />}
            </Button>
          </div>
        </div>

        <div className="p-4 bg-slate-900 text-center">
          <p className="text-sm text-slate-400 mb-4">
            Point camera at a barcode to scan.
          </p>
          <Button variant="secondary" onClick={onClose} className="w-full">
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
