import React, { useState, useMemo, useRef, useEffect } from 'react';
import { motion } from 'motion/react';
import { RefreshCw, Layout, Circle, Minus, Slash, Image as ImageIcon, Shuffle, X } from 'lucide-react';

// Seeded random number generator
function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FRAME_SIZES = [
  { w: 10, h: 15 },
  { w: 15, h: 10 },
  { w: 13, h: 18 },
  { w: 18, h: 13 },
  { w: 15, h: 20 },
  { w: 20, h: 15 },
  { w: 21, h: 30 },
  { w: 30, h: 21 },
  { w: 30, h: 40 },
  { w: 40, h: 30 },
  { w: 40, h: 50 },
  { w: 50, h: 40 },
  { w: 50, h: 70 },
  { w: 70, h: 50 },
  { w: 70, h: 100 },
  { w: 100, h: 70 },
];

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function checkOverlap(r1: Rect, r2: Rect, padding: number): boolean {
  return !(
    r1.x + r1.w + padding <= r2.x ||
    r1.x >= r2.x + r2.w + padding ||
    r1.y + r1.h + padding <= r2.y ||
    r1.y >= r2.y + r2.h + padding
  );
}

function generateFrames(numFrames: number, sizeSpread: number, minSizeIndex: number, random: () => number) {
  const frames = [];
  const maxIndex = FRAME_SIZES.length - 1;
  const range = maxIndex - minSizeIndex;
  const midPoint = minSizeIndex + Math.floor(range / 2);

  for (let i = 0; i < numFrames; i++) {
    if (sizeSpread === 0) {
      frames.push({ ...FRAME_SIZES[midPoint], id: `frame-${i}` });
    } else {
      const deviationRange = Math.round(sizeSpread * range / 2);
      const deviation = Math.floor(random() * (deviationRange * 2 + 1)) - deviationRange;
      const index = Math.max(minSizeIndex, Math.min(maxIndex, midPoint + deviation));
      frames.push({ ...FRAME_SIZES[index], id: `frame-${i}` });
    }
  }
  // Sort largest first for better packing
  frames.sort((a, b) => b.w * b.h - a.w * a.h);
  return frames;
}

function placeFrames(
  frames: { w: number; h: number; id: string }[],
  grouping: string,
  padding: number,
  random: () => number
) {
  const placed: (Rect & { id: string })[] = [];

  // Sort frames: largest first to act as anchors
  const sortedFrames = [...frames].sort((a, b) => {
    const areaDiff = (b.w * b.h) - (a.w * a.h);
    if (areaDiff !== 0) return areaDiff;
    return random() - 0.5;
  });

  // Helper to calculate how well a candidate aligns with existing frames
  const calculateAlignmentScore = (candidate: Rect) => {
    let score = 0;
    let alignedEdges = 0;

    for (const p of placed) {
      // Check horizontal alignment (sharing a vertical edge)
      const isHorizontallyAdjacent = 
        Math.abs(candidate.x - (p.x + p.w + padding)) < 0.1 || 
        Math.abs((candidate.x + candidate.w + padding) - p.x) < 0.1;
      
      if (isHorizontallyAdjacent) {
        // Top alignment
        if (Math.abs(candidate.y - p.y) < 0.1) { score += 100; alignedEdges++; }
        // Bottom alignment
        if (Math.abs((candidate.y + candidate.h) - (p.y + p.h)) < 0.1) { score += 100; alignedEdges++; }
        // Center alignment
        if (Math.abs((candidate.y + candidate.h / 2) - (p.y + p.h / 2)) < 0.1) { score += 50; }
      }

      // Check vertical alignment (sharing a horizontal edge)
      const isVerticallyAdjacent = 
        Math.abs(candidate.y - (p.y + p.h + padding)) < 0.1 || 
        Math.abs((candidate.y + candidate.h + padding) - p.y) < 0.1;

      if (isVerticallyAdjacent) {
        // Left alignment
        if (Math.abs(candidate.x - p.x) < 0.1) { score += 100; alignedEdges++; }
        // Right alignment
        if (Math.abs((candidate.x + candidate.w) - (p.x + p.w)) < 0.1) { score += 100; alignedEdges++; }
        // Center alignment
        if (Math.abs((candidate.x + candidate.w / 2) - (p.x + p.w / 2)) < 0.1) { score += 50; }
      }
    }
    
    // Bonus for multiple aligned edges (fits perfectly into a corner/slot)
    if (alignedEdges >= 2) score += 200;

    return score;
  };

  // Helper to calculate bounding box of all placed frames + candidate
  const getBoundingBox = (candidate: Rect) => {
    let minX = candidate.x, minY = candidate.y, maxX = candidate.x + candidate.w, maxY = candidate.y + candidate.h;
    for (const p of placed) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + p.w);
      maxY = Math.max(maxY, p.y + p.h);
    }
    return { w: maxX - minX, h: maxY - minY, cx: minX + (maxX - minX) / 2, cy: minY + (maxY - minY) / 2 };
  };

  for (let i = 0; i < sortedFrames.length; i++) {
    const frame = sortedFrames[i];
    
    // If it's the first frame, place it at the origin
    if (i === 0) {
      placed.push({ x: 0, y: 0, w: frame.w, h: frame.h, id: frame.id });
      continue;
    }

    let bestPos = { x: 0, y: 0 };
    let maxScore = -Infinity;

    // Generate candidate positions based on existing frames
    // We only want to place new frames exactly `padding` distance away from existing ones
    const candidates: Rect[] = [];
    
    for (const p of placed) {
      // Possible x positions: aligned left, aligned right, centered, or adjacent left/right
      const xPositions = [
        p.x, // Align left
        p.x + p.w - frame.w, // Align right
        p.x + (p.w - frame.w) / 2, // Center horizontally
        p.x - frame.w - padding, // Adjacent left
        p.x + p.w + padding // Adjacent right
      ];

      // Possible y positions: aligned top, aligned bottom, centered, or adjacent top/bottom
      const yPositions = [
        p.y, // Align top
        p.y + p.h - frame.h, // Align bottom
        p.y + (p.h - frame.h) / 2, // Center vertically
        p.y - frame.h - padding, // Adjacent top
        p.y + p.h + padding // Adjacent bottom
      ];

      // Combine x and y to create candidate positions
      // Only keep candidates that are adjacent to at least one placed frame
      for (const x of xPositions) {
        for (const y of yPositions) {
          const candidate = { x, y, w: frame.w, h: frame.h };
          
          // Must be exactly `padding` away from at least one frame
          let isAdjacent = false;
          for (const other of placed) {
            const isHorizAdj = (Math.abs(candidate.x - (other.x + other.w + padding)) < 0.1 || Math.abs((candidate.x + candidate.w + padding) - other.x) < 0.1) && 
                               !(candidate.y >= other.y + other.h || candidate.y + candidate.h <= other.y);
            const isVertAdj = (Math.abs(candidate.y - (other.y + other.h + padding)) < 0.1 || Math.abs((candidate.y + candidate.h + padding) - other.y) < 0.1) &&
                              !(candidate.x >= other.x + other.w || candidate.x + candidate.w <= other.x);
            
            if (isHorizAdj || isVertAdj) {
              isAdjacent = true;
              break;
            }
          }

          if (isAdjacent && !checkOverlap(candidate, {x:0, y:0, w:0, h:0}, padding)) { // checkOverlap needs to check against ALL placed, not just 0,0
             let overlap = false;
             for (const existing of placed) {
               if (checkOverlap(candidate, existing, padding)) {
                 overlap = true;
                 break;
               }
             }
             if (!overlap) {
               candidates.push(candidate);
             }
          }
        }
      }
    }

    // Evaluate candidates
    for (const candidate of candidates) {
      const alignmentScore = calculateAlignmentScore(candidate);
      const bbox = getBoundingBox(candidate);
      
      let shapeScore = 0;
      
      // Calculate distance from center of candidate to center of bounding box
      const distToCenter = Math.sqrt(Math.pow(candidate.x + candidate.w/2 - bbox.cx, 2) + Math.pow(candidate.y + candidate.h/2 - bbox.cy, 2));

      if (grouping === 'circular') {
        // Prefer compactness (smaller bounding box, closer to center)
        shapeScore = -distToCenter * 2 - Math.max(bbox.w, bbox.h);
      } else if (grouping === 'linear') {
        // Prefer wide layouts
        shapeScore = bbox.w - bbox.h * 3 - Math.abs(candidate.y + candidate.h/2 - bbox.cy) * 5;
      } else if (grouping === 'diagonal') {
        // Prefer diagonal alignment
        const cx = candidate.x + candidate.w/2;
        const cy = candidate.y + candidate.h/2;
        const distToLine = Math.abs(cx - cy) / Math.sqrt(2);
        shapeScore = -distToLine * 10 - distToCenter;
      } else if (grouping === 'random') {
        shapeScore = random() * 100 - distToCenter;
      }

      // Combine scores: alignment is highly prioritized to ensure grid-like structure
      const totalScore = alignmentScore * 10 + shapeScore;

      if (totalScore > maxScore) {
        maxScore = totalScore;
        bestPos = { x: candidate.x, y: candidate.y };
      }
    }

    placed.push({ ...bestPos, w: frame.w, h: frame.h, id: frame.id });
  }

  return placed;
}

export default function App() {
  const [mode, setMode] = useState<'auto' | 'manual'>('auto');
  const [numFrames, setNumFrames] = useState(6);
  const [sizeSpread, setSizeSpread] = useState(0.5);
  const [minSizeIndex, setMinSizeIndex] = useState(0);
  const [padding, setPadding] = useState(5);
  const [grouping, setGrouping] = useState('circular');
  const [sizeSeed, setSizeSeed] = useState(42);
  const [placementSeed, setPlacementSeed] = useState(100);

  const [manualFrames, setManualFrames] = useState<{w: number, h: number, id: string}[]>([]);
  const [selectedManualSizeIndex, setSelectedManualSizeIndex] = useState(8);

  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ w: 800, h: 600 });

  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      if (entries[0]) {
        setContainerSize({
          w: entries[0].contentRect.width,
          h: entries[0].contentRect.height,
        });
      }
    });
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const autoFrames = useMemo(() => {
    const sizeRandom = mulberry32(sizeSeed);
    return generateFrames(numFrames, sizeSpread, minSizeIndex, sizeRandom);
  }, [numFrames, sizeSpread, minSizeIndex, sizeSeed]);

  const framesToPlace = mode === 'auto' ? autoFrames : manualFrames;

  const layout = useMemo(() => {
    const placementRandom = mulberry32(placementSeed);
    return placeFrames(framesToPlace, grouping, padding, placementRandom);
  }, [framesToPlace, padding, grouping, placementSeed]);

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  layout.forEach((f) => {
    minX = Math.min(minX, f.x);
    minY = Math.min(minY, f.y);
    maxX = Math.max(maxX, f.x + f.w);
    maxY = Math.max(maxY, f.y + f.h);
  });

  const layoutWidth = maxX - minX || 1;
  const layoutHeight = maxY - minY || 1;

  const paddingX = 100;
  const paddingY = 100;

  const scale = Math.min(
    (containerSize.w - paddingX) / layoutWidth,
    (containerSize.h - paddingY) / layoutHeight
  );

  const offsetX = (containerSize.w - layoutWidth * scale) / 2 - minX * scale;
  const offsetY = (containerSize.h - layoutHeight * scale) / 2 - minY * scale;

  return (
    <div className="flex flex-col md:flex-row h-screen bg-stone-100 text-stone-900 font-sans">
      {/* Sidebar */}
      <div className="w-full md:w-80 bg-white border-r border-stone-200 p-6 flex flex-col gap-8 overflow-y-auto shadow-sm z-10 shrink-0">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <ImageIcon className="text-stone-700" size={24} />
            <h1 className="text-2xl font-semibold tracking-tight">Collage</h1>
          </div>
          <p className="text-sm text-stone-500">Design your perfect wall gallery.</p>
        </div>

        {/* Controls */}
        <div className="space-y-8">
          <div className="flex bg-stone-100 p-1 rounded-lg">
            <button
              onClick={() => setMode('auto')}
              className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${mode === 'auto' ? 'bg-white shadow-sm text-stone-900' : 'text-stone-500 hover:text-stone-700'}`}
            >
              Auto
            </button>
            <button
              onClick={() => {
                if (mode === 'auto') {
                  setManualFrames(autoFrames.map(f => ({...f, id: `manual-${Date.now()}-${Math.random()}`})));
                }
                setMode('manual');
              }}
              className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${mode === 'manual' ? 'bg-white shadow-sm text-stone-900' : 'text-stone-500 hover:text-stone-700'}`}
            >
              Manual
            </button>
          </div>

          {mode === 'auto' ? (
            <>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <label className="text-sm font-medium">Number of Frames</label>
                  <span className="text-sm font-mono bg-stone-100 px-2 py-1 rounded text-stone-600">
                    {numFrames}
                  </span>
                </div>
                <input
                  type="range"
                  min="2"
                  max="20"
                  value={numFrames}
                  onChange={(e) => setNumFrames(Number(e.target.value))}
                  className="w-full accent-stone-800"
                />
              </div>

              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <label className="text-sm font-medium">Size Variation</label>
                  <span className="text-sm font-mono bg-stone-100 px-2 py-1 rounded text-stone-600">
                    {Math.round(sizeSpread * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={sizeSpread}
                  onChange={(e) => setSizeSpread(Number(e.target.value))}
                  className="w-full accent-stone-800"
                />
              </div>

              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <label className="text-sm font-medium">Minimum Size</label>
                  <span className="text-sm font-mono bg-stone-100 px-2 py-1 rounded text-stone-600">
                    {FRAME_SIZES[minSizeIndex].w}x{FRAME_SIZES[minSizeIndex].h}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max={FRAME_SIZES.length - 1}
                  value={minSizeIndex}
                  onChange={(e) => setMinSizeIndex(Number(e.target.value))}
                  className="w-full accent-stone-800"
                />
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <label className="text-sm font-medium">Frames</label>
                <span className="text-sm font-mono bg-stone-100 px-2 py-1 rounded text-stone-600">
                  {manualFrames.length}
                </span>
              </div>
              
              <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto p-2 bg-stone-50 rounded-lg border border-stone-200">
                {manualFrames.map((f) => (
                  <div key={f.id} className="flex items-center gap-1 bg-white border border-stone-200 px-2 py-1 rounded shadow-sm text-xs font-mono">
                    {f.w}x{f.h}
                    <button onClick={() => setManualFrames(manualFrames.filter(mf => mf.id !== f.id))} className="text-stone-400 hover:text-red-500 ml-1">
                      <X size={14} />
                    </button>
                  </div>
                ))}
                {manualFrames.length === 0 && <div className="text-xs text-stone-400 p-1">No frames added</div>}
              </div>

              <div className="flex gap-2">
                <select 
                  value={selectedManualSizeIndex}
                  onChange={(e) => setSelectedManualSizeIndex(Number(e.target.value))}
                  className="flex-1 bg-white border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-stone-800"
                >
                  {FRAME_SIZES.map((size, i) => (
                    <option key={i} value={i}>{size.w}x{size.h} cm</option>
                  ))}
                </select>
                <button 
                  onClick={() => {
                    const size = FRAME_SIZES[selectedManualSizeIndex];
                    setManualFrames([...manualFrames, { ...size, id: `manual-${Date.now()}-${Math.random()}` }]);
                  }}
                  className="bg-stone-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-stone-700 transition-colors"
                >
                  Add
                </button>
              </div>
            </div>
          )}

          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <label className="text-sm font-medium">Spacing</label>
              <span className="text-sm font-mono bg-stone-100 px-2 py-1 rounded text-stone-600">
                {padding} cm
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="20"
              value={padding}
              onChange={(e) => setPadding(Number(e.target.value))}
              className="w-full accent-stone-800"
            />
          </div>

          <div className="space-y-3">
            <label className="text-sm font-medium">Grouping Style</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setGrouping('circular')}
                className={`flex items-center justify-center gap-2 p-2.5 rounded-lg border transition-colors ${
                  grouping === 'circular'
                    ? 'bg-stone-800 text-white border-stone-800'
                    : 'bg-white border-stone-200 hover:bg-stone-50 text-stone-600'
                }`}
              >
                <Circle size={16} /> <span className="text-sm font-medium">Circular</span>
              </button>
              <button
                onClick={() => setGrouping('linear')}
                className={`flex items-center justify-center gap-2 p-2.5 rounded-lg border transition-colors ${
                  grouping === 'linear'
                    ? 'bg-stone-800 text-white border-stone-800'
                    : 'bg-white border-stone-200 hover:bg-stone-50 text-stone-600'
                }`}
              >
                <Minus size={16} /> <span className="text-sm font-medium">Linear</span>
              </button>
              <button
                onClick={() => setGrouping('diagonal')}
                className={`flex items-center justify-center gap-2 p-2.5 rounded-lg border transition-colors ${
                  grouping === 'diagonal'
                    ? 'bg-stone-800 text-white border-stone-800'
                    : 'bg-white border-stone-200 hover:bg-stone-50 text-stone-600'
                }`}
              >
                <Slash size={16} /> <span className="text-sm font-medium">Diagonal</span>
              </button>
              <button
                onClick={() => setGrouping('random')}
                className={`flex items-center justify-center gap-2 p-2.5 rounded-lg border transition-colors ${
                  grouping === 'random'
                    ? 'bg-stone-800 text-white border-stone-800'
                    : 'bg-white border-stone-200 hover:bg-stone-50 text-stone-600'
                }`}
              >
                <Layout size={16} /> <span className="text-sm font-medium">Random</span>
              </button>
            </div>
          </div>

          <div className="flex gap-2">
            {mode === 'auto' && (
              <button
                onClick={() => setSizeSeed((s) => s + 1)}
                className="flex-1 flex items-center justify-center gap-2 py-3 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-lg transition-colors font-medium border border-stone-200 shadow-sm text-sm"
              >
                <RefreshCw size={16} /> New Sizes
              </button>
            )}
            <button
              onClick={() => setPlacementSeed((s) => s + 1)}
              className="flex-1 flex items-center justify-center gap-2 py-3 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-lg transition-colors font-medium border border-stone-200 shadow-sm text-sm"
            >
              <Shuffle size={16} /> Redo Layout
            </button>
          </div>
        </div>
      </div>

      {/* Wall Area */}
      <div
        className="flex-1 relative overflow-hidden bg-stone-100 flex items-center justify-center"
        ref={containerRef}
      >
        {/* Wall Grid (10cm squares) */}
        <div
          className="absolute inset-0 transition-all duration-300"
          style={{
            backgroundImage: 'radial-gradient(#d6d3d1 1px, transparent 1px)',
            backgroundSize: `${10 * scale}px ${10 * scale}px`,
            backgroundPosition: `${offsetX}px ${offsetY}px`,
            opacity: 0.4,
          }}
        />

        {/* Frames */}
        <div className="absolute inset-0 pointer-events-none">
          {layout.map((frame) => {
            const mattingSize = 4 * scale;
            const innerPadding = 0.5 * scale;

            return (
              <motion.div
                key={frame.id}
                initial={false}
                animate={{
                  x: frame.x * scale + offsetX,
                  y: frame.y * scale + offsetY,
                  width: frame.w * scale,
                  height: frame.h * scale,
                }}
                transition={{ type: 'spring', stiffness: 200, damping: 25 }}
                className="absolute bg-white flex items-center justify-center overflow-hidden"
                style={{
                  boxShadow:
                    '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
                  border: `${Math.max(1, 1 * scale)}px solid #292524`, // Dark frame edge
                }}
              >
                {/* Matting */}
                <div
                  className="bg-[#fafaf9] flex items-center justify-center shadow-inner"
                  style={{
                    width: `calc(100% - ${mattingSize * 2}px)`,
                    height: `calc(100% - ${mattingSize * 2}px)`,
                    border: `${Math.max(1, 0.2 * scale)}px solid #e7e5e4`,
                  }}
                >
                  {/* Image Placeholder */}
                  <div
                    className="bg-stone-200 flex items-center justify-center overflow-hidden relative"
                    style={{
                      width: `calc(100% - ${innerPadding * 2}px)`,
                      height: `calc(100% - ${innerPadding * 2}px)`,
                      boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.05)',
                    }}
                  >
                    {/* Abstract image pattern */}
                    <div className="absolute inset-0 opacity-10" style={{
                      backgroundImage: 'repeating-linear-gradient(45deg, #000 0, #000 1px, transparent 1px, transparent 10px)'
                    }} />
                    <span
                      className="text-stone-500 font-mono relative z-10 bg-stone-200/80 px-1 rounded"
                      style={{ fontSize: `${Math.max(10, 2.5 * scale)}px` }}
                    >
                      {frame.w}x{frame.h}
                    </span>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
