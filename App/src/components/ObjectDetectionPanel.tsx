import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Scan,
  AlertCircle,
  Download,
  Box,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
} from "lucide-react";
import {
  detectObjects,
  ObjectDetectionOptions,
  ObjectDetectionResult,
  DetectionBox,
  UrbanFeatureCategory,
} from "@/lib/objectDetection";
import { inferWithModel } from "@/lib/detectionModel";
import { LabelExportPayload, LabelingSummary } from "@/types/semantic";



interface ObjectDetectionPanelProps {

  afterImage?: File | null;

  onDetectionComplete?: (results: ObjectDetectionResult | null) => void;

  semanticSummary?: LabelingSummary | null;

  semanticExport?: LabelExportPayload | null;

}



type DetectionPresetId = "urban-activity" | "infrastructure" | "waterways" | "custom";

type DetectionPreset = {
  id: DetectionPresetId;
  label: string;
  description: string;
  options?: ObjectDetectionOptions;
};

const DETECTION_PRESETS: DetectionPreset[] = [
  {
    id: "urban-activity",
    label: "Structures (Buildings)",
    description: "Optimised to surface building footprints and dense compound scatter.",
    options: {
      thresholdPercentile: 90,
      minAreaPixels: 100,
      maxDetections: 220,
    },
  },
  {
    id: "infrastructure",
    label: "Linear Infrastructure",
    description: "Tuned for bridges, walls and elongated infrastructure features.",
    options: {
      thresholdPercentile: 88,
      minAreaPixels: 60,
      maxDetections: 180,
    },
  },
  {
    id: "waterways",
    label: "Hydrology (Rivers)",
    description: "Detects broad, diffuse returns from channels, rivers and drainage.",
    options: {
      thresholdPercentile: 86,
      minAreaPixels: 140,
      maxDetections: 160,
    },
  },
  {
    id: "custom",
    label: "Custom Threshold",
    description: "Manually tune detection parameters for specialised scenes.",
  },
];

const PRESET_LOOKUP = DETECTION_PRESETS.reduce(
  (acc, preset) => {
    acc[preset.id] = preset;
    return acc;
  },
  {} as Record<DetectionPresetId, DetectionPreset>,
);

const DEFAULT_PRESET_ID: DetectionPresetId = "infrastructure";

const DEFAULT_OPTIONS: ObjectDetectionOptions = {
  ...PRESET_LOOKUP[DEFAULT_PRESET_ID].options!,
};

type CategoryOption = {
  id: UrbanFeatureCategory;
  label: string;
  accent: string;
  fill: string;
  fillStrong: string;
};

const CATEGORY_OPTIONS: CategoryOption[] = [
  {
    id: "building",
    label: "Buildings",
    accent: "#00ffa4",
    fill: "rgba(0, 255, 164, 0.14)",
    fillStrong: "rgba(0, 255, 164, 0.3)",
  },
  {
    id: "border-wall",
    label: "Border Walls",
    accent: "#ff6347",
    fill: "rgba(255, 99, 71, 0.14)",
    fillStrong: "rgba(255, 99, 71, 0.32)",
  },
  {
    id: "bridge",
    label: "Bridges",
    accent: "#ffb347",
    fill: "rgba(255, 179, 71, 0.14)",
    fillStrong: "rgba(255, 179, 71, 0.32)",
  },
  {
    id: "river",
    label: "Rivers & Waterways",
    accent: "#4169e1",
    fill: "rgba(65, 105, 225, 0.14)",
    fillStrong: "rgba(65, 105, 225, 0.3)",
  },
  {
    id: "urban-feature",
    label: "Other Urban Scatter",
    accent: "#add8e6",
    fill: "rgba(173, 216, 230, 0.14)",
    fillStrong: "rgba(173, 216, 230, 0.28)",
  },
];

const CATEGORY_LOOKUP: Record<UrbanFeatureCategory, CategoryOption> = CATEGORY_OPTIONS.reduce(
  (acc, option) => {
    acc[option.id] = option;
    return acc;
  },
  {} as Record<UrbanFeatureCategory, CategoryOption>,
);

const createDefaultCategoryState = (): Record<UrbanFeatureCategory, boolean> =>
  CATEGORY_OPTIONS.reduce((acc, option) => {
    acc[option.id] = true;
    return acc;
  }, {} as Record<UrbanFeatureCategory, boolean>);

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;


function formatConfidence(value: number): string {

  return `${(value * 100).toFixed(1)}%`;

}



function formatArea(areaPixels: number, pixelScale?: [number, number]): string {

  if (!pixelScale) {

    return `${areaPixels.toLocaleString()} px`;

  }

  const pixelArea = Math.abs(pixelScale[0] * pixelScale[1]);

  if (!Number.isFinite(pixelArea)) {

    return `${areaPixels.toLocaleString()} px`;

  }

  const areaM2 = areaPixels * pixelArea;

  if (areaM2 >= 1_000_000) {

    return `${(areaM2 / 1_000_000).toFixed(3)} km2`;

  }

  if (areaM2 >= 10_000) {

    return `${(areaM2 / 10_000).toFixed(2)} ha`;

  }

  return `${areaM2.toFixed(0)} m2`;

}



function escapeCsv(value: string | number): string {

  const str = String(value);

  if (/[",\r\n]/.test(str)) {

    return '"' + str.replace(/"/g, '""') + '"';

  }

  return str;

}





const ObjectDetectionPanel: React.FC<ObjectDetectionPanelProps> = ({

  afterImage = null,

  onDetectionComplete = () => {},

  semanticSummary = null,

  semanticExport = null,

}) => {

  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [useModel, setUseModel] = useState<boolean>(false);

  const [progress, setProgress] = useState<number>(0);

  const [error, setError] = useState<string>("");

  const [results, setResults] = useState<ObjectDetectionResult | null>(null);

  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null);
  const [showDebugMasks, setShowDebugMasks] = useState<boolean>(false);



  const [thresholdPercentile, setThresholdPercentile] = useState<number>(DEFAULT_OPTIONS.thresholdPercentile);
  const [minAreaPixels, setMinAreaPixels] = useState<number>(DEFAULT_OPTIONS.minAreaPixels);
  const [maxDetections, setMaxDetections] = useState<number | undefined>(DEFAULT_OPTIONS.maxDetections);
  const DEFAULT_MIN_CONFIDENCE = 0.35;
  const [minConfidence, setMinConfidence] = useState<number>(DEFAULT_MIN_CONFIDENCE);
  const [displayMode, setDisplayMode] = useState<DetectionPresetId>(DEFAULT_PRESET_ID);
  const [activeCategories, setActiveCategories] = useState<Record<UrbanFeatureCategory, boolean>>(() => createDefaultCategoryState());
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  useEffect(() => {
    if (results) return;
    const preset = PRESET_LOOKUP[displayMode];
    if (preset?.options) {
      setThresholdPercentile(preset.options.thresholdPercentile);
      setMinAreaPixels(preset.options.minAreaPixels);
      setMaxDetections(preset.options.maxDetections);
    }
    // If user selects infrastructure preset, exclude bridges and rivers by default
    if (displayMode === "infrastructure") {
      setActiveCategories((prev) => ({
        ...prev,
        ["bridge"]: false,
        ["river"]: false,
      } as Record<UrbanFeatureCategory, boolean>));
    }
  }, [displayMode, results]);

  const categoryCounts = useMemo(() => {
    const counts = CATEGORY_OPTIONS.reduce((acc, option) => {
      acc[option.id] = 0;
      return acc;
    }, {} as Record<UrbanFeatureCategory, number>);
    if (results) {
      results.boxes.forEach((box) => {
        counts[box.categoryId] = (counts[box.categoryId] ?? 0) + 1;
      });
    }
    return counts;
  }, [results]);

  const visibleBoxes = useMemo(() => {
    if (!results) return [] as DetectionBox[];
    return results.boxes.filter((box) => activeCategories[box.categoryId] && box.confidence >= minConfidence);
  }, [results, activeCategories, minConfidence]);

  useEffect(() => {
    if (!results) return;
    if (!visibleBoxes.length) {
      setSelectedBoxId(null);
      return;
    }
    setSelectedBoxId((previous) => {
      if (previous && visibleBoxes.some((box) => box.id === previous)) {
        return previous;
      }
      return visibleBoxes[0]?.id ?? null;
    });
  }, [results, visibleBoxes]);

  const activeBox = useMemo(() => {
    if (!selectedBoxId) return null;
    return visibleBoxes.find((box) => box.id === selectedBoxId) ?? null;
  }, [selectedBoxId, visibleBoxes]);

  const visibleAverageConfidence = useMemo(() => {
    if (!visibleBoxes.length) return 0;
    const sum = visibleBoxes.reduce((acc, box) => acc + box.confidence, 0);
    return sum / visibleBoxes.length;
  }, [visibleBoxes]);

  const activeCategory = useMemo(() => (activeBox ? CATEGORY_LOOKUP[activeBox.categoryId] : null), [activeBox]);

  const zoomDisplay = useMemo(() => zoomLevel.toFixed(2), [zoomLevel]);
  const semanticInsights = useMemo(() => {

    if (!semanticSummary || !semanticSummary.labels.length) {

      return null;

    }

    const counts: Record<string, number> = {};

    semanticSummary.annotations.forEach((annotation) => {

      counts[annotation.labelId] = (counts[annotation.labelId] ?? 0) + 1;

    });

    const sortedLabels = [...semanticSummary.labels].sort((a, b) => b.coverage - a.coverage);

    const totalCoverage = sortedLabels.reduce((sum, label) => sum + label.coverage, 0);

    const averageConfidence = sortedLabels.reduce((sum, label) => sum + label.confidence, 0) / sortedLabels.length;

    return {

      counts,

      sortedLabels,

      totalCoverage: Number(totalCoverage.toFixed(1)),

      totalSamples: semanticSummary.annotations.length,

      totalClasses: sortedLabels.length,

      averageConfidence: Number(averageConfidence.toFixed(1)),

    };

  }, [semanticSummary]);

  const topSemanticLabels = semanticInsights ? semanticInsights.sortedLabels.slice(0, 3) : [];

  const hasSemanticBundle = Boolean(semanticInsights || semanticExport);

  const bundleSampleTotal = semanticInsights?.totalSamples ?? (semanticExport?.geojson?.features?.length ?? 0);

  const bundleLabelTotal = semanticInsights?.totalClasses ?? (semanticSummary?.labels.length ?? 0);



  const handleRunDetection = async () => {

    if (!afterImage) {

      setError("Please upload an after image first");

      return;

    }



    setError("");

    setIsProcessing(true);

    setProgress(6);



    try {
      const detection = await detectObjects(afterImage, {
        thresholdPercentile,
        minAreaPixels,
        maxDetections,
      });

      // If model inference enabled, attempt to call server model and merge results
      let modelResp: { boxes: DetectionBox[] } | null = null;
      if (useModel) {
        try {
          modelResp = await inferWithModel(afterImage as File);
        } catch (err) {
          console.warn("Model inference failed", err);
          modelResp = null;
        }
      }

      // Merge model boxes with algorithmic boxes when available.
      // Strategy: keep model boxes where confidence >= algorithmic overlap or when no overlap.
      let mergedBoxes: DetectionBox[] = detection.boxes.slice();
      if (modelResp && Array.isArray(modelResp.boxes) && modelResp.boxes.length) {
        const algBoxes = detection.boxes.slice();
        const used = new Set<string>();
        for (const m of modelResp.boxes) {
          // find best overlapping algorithmic box
          let bestMatch: DetectionBox | null = null;
          let bestIou = 0;
          for (const a of algBoxes) {
            const overlap = (detectObjects as any).iou ? (detectObjects as any).iou(a.bbox, m.bbox) : 0;
            if (overlap > bestIou) {
              bestIou = overlap;
              bestMatch = a;
            }
          }
          const IOU_THRESHOLD = 0.35;
          if (bestMatch && bestIou >= IOU_THRESHOLD) {
            // prefer model box if model confidence higher, else keep algorithmic
            if ((m.confidence ?? 0) >= (bestMatch.confidence ?? 0)) {
              // replace in mergedBoxes
              mergedBoxes = mergedBoxes.map((b) => (b.id === bestMatch!.id ? m : b));
              used.add(m.id);
            } else {
              // keep algorithmic box, but we may want to augment its confidence
              // increase alg confidence slightly towards model
              mergedBoxes = mergedBoxes.map((b) => (b.id === bestMatch!.id ? { ...b, confidence: Math.max(b.confidence, (m.confidence ?? 0) * 0.9) } : b));
            }
          } else {
            // no overlap: add model detection
            mergedBoxes.push(m);
            used.add(m.id);
          }
        }
        // de-duplicate and sort by confidence
        mergedBoxes = Array.from(new Map(mergedBoxes.map((b) => [b.id, b])).values()).sort((a, b) => b.confidence - a.confidence);
      }

      setActiveCategories(createDefaultCategoryState());
      setZoomLevel(1);
      setIsFullscreen(false);
      // attach debug urls if present on detectObjects.__lastDebug
      const debugUrls = (detectObjects as any).__lastDebug as Record<string, string> | undefined;
      if (debugUrls) {
        (detection as any).debugMaskUrls = debugUrls;
      }
      // If mergedBoxes were created, attach them
      const finalDetection = { ...detection, boxes: mergedBoxes } as ObjectDetectionResult;
      // expose whether model was used and available
      (finalDetection as any).modelUsed = Boolean(useModel);
      (finalDetection as any).modelAvailable = Boolean(modelResp && modelResp.boxes?.length);
      setResults(finalDetection);
      setSelectedBoxId(finalDetection.boxes[0]?.id ?? null);
  // reset confidence floor to the default after each run
  setMinConfidence(DEFAULT_MIN_CONFIDENCE);
      onDetectionComplete(detection);
      setProgress(100);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Object detection failed. Please try again.");
      setResults(null);
      setSelectedBoxId(null);
      onDetectionComplete(null);
    } finally {
      setTimeout(() => setIsProcessing(false), 300);

      setTimeout(() => setProgress(0), 1200);

    }

  };



  const handleCategoryToggle = (categoryId: UrbanFeatureCategory, checked: boolean) => {
    setActiveCategories((previous) => ({ ...previous, [categoryId]: checked }));
  };

  const handleZoomIn = () => {
    setZoomLevel((current) => Math.min(MAX_ZOOM, Number((current + ZOOM_STEP).toFixed(2))));
  };

  const handleZoomOut = () => {
    setZoomLevel((current) => Math.max(MIN_ZOOM, Number((current - ZOOM_STEP).toFixed(2))));
  };

  const handleResetZoom = () => {
    setZoomLevel(1);
  };

  const handleToggleFullscreen = () => {
    setIsFullscreen((prev) => !prev);
  };

  const renderPreview = () => {
    if (!results) {
      return (
        <div className="flex items-center justify-center h-full min-h-[360px]">
          <div className="text-center p-8 glass-card rounded-lg space-y-3">
            <Scan className="h-12 w-12 text-primary mx-auto mb-2 pulse-glow" />
            <h3 className="text-lg font-medium font-orbitron holographic">
              Urban Feature Detection
            </h3>
            <p className="text-muted-foreground mt-2 max-w-md mx-auto">
              Configure detection parameters and run analysis to surface buildings, border walls, bridges, and waterways within your SAR scene.
            </p>
          </div>
        </div>
      );
    }

    const renderImage = (maxHeightClass: string) => (
      <div className="relative border border-cyan-500/30 rounded-lg overflow-hidden shadow-lg bg-slate-950/40">
        <div className={`relative overflow-auto ${maxHeightClass}`}>
          <div
            className="relative"
            style={{
              width: results.previewWidth,
              height: results.previewHeight,
              transform: `scale(${zoomLevel})`,
              transformOrigin: "top left",
            }}
          >
            <img
              src={results.basePreviewUrl}
              alt="Object detection preview"
              className="block select-none"
              style={{
                width: results.previewWidth,
                height: results.previewHeight,
              }}
            />
            <div className="absolute inset-0">
              {visibleBoxes.map((box) => {
                const isActive = box.id === selectedBoxId;
                const category = CATEGORY_LOOKUP[box.categoryId];
                return (
                  <div
                    key={box.id}
                    className="absolute transition-all rounded-sm"
                    style={{
                      left: box.previewBox.x,
                      top: box.previewBox.y,
                      width: Math.max(2, box.previewBox.width),
                      height: Math.max(2, box.previewBox.height),
                      border: `1.5px solid ${category.accent}`,
                      backgroundColor: isActive ? category.fillStrong : category.fill,
                      boxShadow: isActive ? `0 0 12px ${category.accent}` : undefined,
                    }}
                  >
                    <div
                      className="absolute left-0 top-0 text-[10px] font-semibold px-1 py-0.5 tracking-wide"
                      style={{
                        backgroundColor: "rgba(10, 15, 20, 0.85)",
                        color: category.accent,
                      }}
                    >
                      {`${box.label} ${formatConfidence(box.confidence)}`}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );

    const noActiveCategories = Object.values(activeCategories).every((value) => !value);

    const content = visibleBoxes.length
      ? renderImage("max-h-[480px]")
      : (
        <div className="flex items-center justify-center min-h-[320px] rounded-lg border border-cyan-500/30 bg-slate-950/60">
          <div className="text-center space-y-3 p-8">
            <Box className="h-10 w-10 mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {noActiveCategories
                ? "Enable at least one layer to show detections."
                : "No detections match the selected layers yet."}
            </p>
          </div>
        </div>
      );

    return (
      <>
        <div className="flex flex-col lg:flex-row gap-6">
          <div className="w-full lg:w-72 xl:w-80 space-y-3">
              <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-cyan-400 uppercase tracking-wide">
                Detected Objects
              </h3>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="border-cyan-500 text-cyan-300">
                  {visibleBoxes.length}/{results.stats.totalDetections}
                </Badge>
                <span className="text-xs text-muted-foreground">Confidence floor:</span>
                <Badge variant="outline" className="border-emerald-400 text-emerald-300">
                  {formatConfidence(minConfidence)}
                </Badge>
              </div>
            </div>
            <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
              {visibleBoxes.length === 0 ? (
                <div className="glass-card rounded-lg px-3 py-4 text-sm text-muted-foreground">
                  {noActiveCategories
                    ? "Select one or more categories to inspect detections."
                    : "Filtered categories currently have no detections."}
                </div>
              ) : (
                visibleBoxes.map((box) => {
                  const isActive = box.id === selectedBoxId;
                  const category = CATEGORY_LOOKUP[box.categoryId];
                  return (
                    <button
                      key={box.id}
                      type="button"
                      onClick={() => setSelectedBoxId(box.id)}
                      className={`w-full text-left glass-card px-3 py-3 rounded-lg transition-all border ${
                        isActive ? "ring-1 ring-cyan-400" : "border-transparent hover:border-cyan-500/40"
                      }`}
                      style={{
                        backgroundColor: isActive ? category.fillStrong : "rgba(12, 20, 28, 0.65)",
                        borderColor: isActive ? category.accent : undefined,
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-2.5 h-2.5 rounded-full"
                            style={{ backgroundColor: category.accent }}
                          />
                          <span className="text-sm font-medium text-foreground">
                            {box.label}
                          </span>
                        </div>
                        <span className="text-xs text-muted-foreground uppercase">
                          {formatConfidence(box.confidence)}
                        </span>
                      </div>
                      <div className="mt-1 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                        <span>Area</span>
                        <span className="text-foreground text-right">
                          {formatArea(box.areaPixels, results.pixelScale)}
                        </span>
                        <span>Span</span>
                        <span className="text-foreground text-right">
                          {`${box.bbox.width} x ${box.bbox.height} px`}
                        </span>
                      </div>
                      {box.notes && (
                        <p className="mt-2 text-xs text-muted-foreground leading-snug">
                          {box.notes}
                        </p>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className="relative flex-1 space-y-4">
            <div className="glass-card border border-cyan-500/30 rounded-lg p-3 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-cyan-300">
                    Focus Layers
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    Toggle categories to control which detections remain visible.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-9 w-9"
                    onClick={handleZoomOut}
                    disabled={zoomLevel <= MIN_ZOOM}
                  >
                    <ZoomOut className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-9 w-9"
                    onClick={handleZoomIn}
                    disabled={zoomLevel >= MAX_ZOOM}
                  >
                    <ZoomIn className="h-4 w-4" />
                  </Button>
                  <span className="text-xs text-muted-foreground w-14 text-center font-medium">
                    {zoomDisplay}x
                  </span>
                  <Button
                    variant="outline"
                    className="h-9 px-3"
                    onClick={handleResetZoom}
                    disabled={Math.abs(zoomLevel - 1) < 0.001}
                  >
                    Reset
                  </Button>
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-9 w-9"
                    onClick={handleToggleFullscreen}
                  >
                    {isFullscreen ? (
                      <Minimize2 className="h-4 w-4" />
                    ) : (
                      <Maximize2 className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {CATEGORY_OPTIONS.map((category) => {
                  const checked = activeCategories[category.id];
                  const total = categoryCounts[category.id] ?? 0;
                  return (
                    <label
                      key={category.id}
                      className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition focus-within:ring-2 focus-within:ring-cyan-400/50 ${
                        checked ? "border-transparent" : "border-cyan-500/20"
                      }`}
                      style={{
                        backgroundColor: checked ? category.fill : "transparent",
                      }}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(state) => handleCategoryToggle(category.id, state === true)}
                        className="h-4 w-4 data-[state=checked]:bg-cyan-500 data-[state=checked]:border-cyan-500"
                      />
                      <span className="text-foreground font-medium">{category.label}</span>
                      <Badge
                        variant="secondary"
                        className="bg-transparent border text-[10px]"
                        style={{
                          borderColor: category.accent,
                          color: category.accent,
                        }}
                      >
                        {total}
                      </Badge>
                    </label>
                  );
                })}
              </div>
            </div>

            {content}
          </div>
        </div>

        {isFullscreen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-6">
            <div className="relative w-full max-w-6xl space-y-4">
              <div className="flex justify-end">
                <Button
                  variant="secondary"
                  onClick={handleToggleFullscreen}
                  className="flex items-center gap-2"
                >
                  <Minimize2 className="h-4 w-4" />
                  Exit Fullscreen
                </Button>
              </div>
              {renderImage("max-h-[80vh]")}
            </div>
          </div>
        )}
        {/* Debug masks panel */}
        {results?.debugMaskUrls && (
          <div className="mt-4 grid grid-cols-1 gap-2">
            <div className="flex items-center gap-2">
              <Checkbox checked={showDebugMasks} onCheckedChange={(v) => setShowDebugMasks(Boolean(v))} />
              <Label className="text-xs">Show debug masks</Label>
            </div>
            {showDebugMasks && (
              <div className="grid grid-cols-4 gap-2">
                {Object.entries(results.debugMaskUrls!).map(([key, url]) => (
                  <div key={key} className="text-xs text-center">
                    <div className="border rounded overflow-hidden bg-black" style={{ width: 160, height: 120 }}>
                      <img src={url} alt={`${key} mask`} style={{ width: 160, height: 120, objectFit: 'contain' }} />
                    </div>
                    <div className="mt-1">{key}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </>
    );
  };


  const handleExport = (format: "json" | "csv" | "geojson") => {

    if (!results) return;



    const generatedAt = new Date().toISOString();

    const summary = semanticInsights ? semanticSummary : null;

    const sampleGeojson = semanticExport?.geojson ?? null;



    let blob: Blob;

    let filename = "sar_detections";



    switch (format) {

      case "json": {

        const payload = {

          meta: { format, generatedAt },

          stats: results.stats,

          thresholdValue: results.thresholdValue,

          bounds: results.bounds ?? null,

          pixelScale: results.pixelScale ?? null,

          boxes: results.boxes,

          semanticSummary: summary,

          semanticSamples: sampleGeojson,

        };

        blob = new Blob([JSON.stringify(payload, null, 2)], {

          type: "application/json",

        });

        filename += summary || sampleGeojson ? "_with_semantic.json" : ".json";

        break;

      }

      case "csv": {
        const header = [
          "id",
          "category_id",
          "category_label",
          "confidence",
          "x",
          "y",
          "width",
          "height",
          "area_pixels",
        ];
        const rows = results.boxes.map((box) => [
          escapeCsv(box.id),
          escapeCsv(box.categoryId),
          escapeCsv(box.label),
          box.confidence.toFixed(4),
          Math.round(box.bbox.x),
          Math.round(box.bbox.y),
          Math.round(box.bbox.width),
          Math.round(box.bbox.height),
          box.areaPixels,

        ]);

        let csv = [header, ...rows]

          .map((cols) => cols.join(","))

          .join("\r\n");



        if (summary) {

          csv += "\r\n\r\n# Semantic Label Summary";

          csv += `\r\n# Total Classes,${summary.labels.length}`;

          csv += `\r\n# Total Samples,${summary.annotations.length}`;

          csv += "\r\nlabel,coverage_percent,confidence_percent,visible,sample_count";

          summary.labels.forEach((label) => {

            const sampleCount = semanticInsights?.counts[label.id] ?? 0;

            csv += `\r\n${escapeCsv(label.name)},${label.coverage.toFixed(1)},${label.confidence.toFixed(0)},${label.visible ? "yes" : "no"},${sampleCount}`;

          });

        }



        if (sampleGeojson) {

          csv += "\r\n\r\n# Semantic Samples GeoJSON";

          csv += `\r\n${JSON.stringify(sampleGeojson)}`;

        }



        blob = new Blob([csv], { type: "text/csv" });

        filename += summary || sampleGeojson ? "_bundle.csv" : ".csv";

        break;

      }

      case "geojson":

      default: {

        const detectionCollection: any = results.featureCollection

          ? {

              ...results.featureCollection,

              features: [...results.featureCollection.features],

            }

          : { type: "FeatureCollection", features: [] };



        if (sampleGeojson?.features?.length) {

          detectionCollection.features = detectionCollection.features.concat(

            sampleGeojson.features.map((feature: any) => ({

              ...feature,

              properties: {

                ...(feature.properties ?? {}),

                source: "semantic-sample",

              },

            })),

          );

        }



        detectionCollection.properties = {

          ...(detectionCollection.properties ?? {}),

          stats: results.stats,

          thresholdValue: results.thresholdValue,

          generatedAt,

          semanticSummary: summary ?? undefined,

        };



        blob = new Blob([JSON.stringify(detectionCollection, null, 2)], {

          type: "application/geo+json",

        });

        filename += summary || sampleGeojson ? "_with_samples.geojson" : ".geojson";

        break;

      }

    }



    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");

    link.href = url;

    link.download = filename;

    document.body.appendChild(link);

    link.click();

    document.body.removeChild(link);

    URL.revokeObjectURL(url);

  };



  return (

    <div className="space-y-6">

      <div className="flex items-center justify-between">

        <h2 className="text-2xl font-bold text-cyan-400 glow-text flex items-center gap-2">

          <Scan className="h-6 w-6" />

          Object Detection

        </h2>

        <div className="flex items-center gap-2">

          <span className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse"></span>

          <span className="text-sm text-cyan-400">DETECTION SYSTEM</span>

        </div>

      </div>



      {error && (

        <Alert variant="destructive" className="glass-card">

          <AlertCircle className="h-4 w-4" />

          <AlertDescription>{error}</AlertDescription>

        </Alert>

      )}



      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        <div className="space-y-4 lg:col-span-1">

          <Card className="hologram-card">

            <CardHeader>

              <CardTitle className="text-cyan-400 text-lg">Detection Settings</CardTitle>

            </CardHeader>

            <CardContent className="space-y-5">

              <div className="space-y-2">

                <Label className="text-sm font-medium text-foreground">Preset</Label>

                <Select value={displayMode} onValueChange={(value) => setDisplayMode(value as DetectionPresetId)}>
                  <SelectTrigger className="glass-card">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="glass-card">
                    {DETECTION_PRESETS.map((preset) => (
                      <SelectItem key={preset.id} value={preset.id}>
                        <div className="flex flex-col">
                          <span>{preset.label}</span>
                          {preset.description && (
                            <span className="text-xs text-muted-foreground">
                              {preset.description}
                            </span>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>


              <div className="space-y-3">

                <div>

                  <Label className="text-sm font-medium text-foreground flex justify-between">

                    <span>Threshold Percentile</span>

                    <span className="text-cyan-300">{thresholdPercentile}</span>

                  </Label>

                  <Slider

                    value={[thresholdPercentile]}

                    min={70}

                    max={99.9}

                    step={0.1}

                    onValueChange={([value]) => {

                    setThresholdPercentile(Number(value.toFixed(1)));

                    setDisplayMode("custom");

                  }}

                  />

                </div>

                <div>
                  <Label className="text-sm font-medium text-foreground flex justify-between">
                    <span>Minimum Confidence</span>
                    <span className="text-cyan-300">{formatConfidence(minConfidence)}</span>
                  </Label>

                  <Slider
                    value={[minConfidence]}
                    min={0}
                    max={1}
                    step={0.01}
                    onValueChange={([value]) => {
                      setMinConfidence(Number(value.toFixed(2)));
                      setDisplayMode("custom");
                    }}
                  />
                </div>

                <div>

                  <Label className="text-sm font-medium text-foreground flex justify-between">

                    <span>Minimum Area (px)</span>

                    <span className="text-cyan-300">{minAreaPixels}</span>

                  </Label>

                  <Slider

                    value={[minAreaPixels]}

                    min={5}

                    max={400}

                    step={5}

                    onValueChange={([value]) => {

                    setMinAreaPixels(Math.round(value));

                    setDisplayMode("custom");

                  }}

                  />

                </div>

                <div>

                  <Label className="text-sm font-medium text-foreground flex justify-between">

                    <span>Max Detections</span>

                    <span className="text-cyan-300">{maxDetections ?? "?"}</span>

                  </Label>

                  <Slider

                    value={[maxDetections ?? 200]}

                    min={10}

                    max={400}

                    step={10}

                    onValueChange={([value]) => {

                    setMaxDetections(Math.round(value));

                    setDisplayMode("custom");

                  }}

                  />

                </div>

              </div>



              <div className="pt-1">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="use-model"
                      checked={useModel}
                      onCheckedChange={(v) => setUseModel(Boolean(v))}
                    />
                    <Label htmlFor="use-model" className="text-sm">
                      Use server model inference (YOLO/DETR)
                    </Label>
                  </div>
                  <Badge variant="secondary" className="text-xs">
                    Optional
                  </Badge>
                </div>

                <Button

                  className="w-full sci-fi-button font-orbitron"

                  onClick={handleRunDetection}

                  disabled={isProcessing || !afterImage}

                >

                  {isProcessing ? "Detecting..." : "Run Detection"}

                </Button>

                {isProcessing && (

                  <div className="mt-4">

                    <Progress value={progress} className="pulse-glow" />

                    <p className="text-center text-sm text-muted-foreground mt-2 font-orbitron">

                      Scanning SAR imagery... {progress}%

                    </p>

                  </div>

                )}

              </div>

            </CardContent>

          </Card>



          {results && (

            <Card className="glass-card">

              <CardHeader>

                <CardTitle className="text-cyan-400 text-lg">Summary</CardTitle>

              </CardHeader>

              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span>Visible detections</span>
                  <span className="font-semibold text-foreground">
                    {visibleBoxes.length} / {results.stats.totalDetections}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Average confidence</span>
                  <span className="font-semibold text-foreground">
                    {visibleBoxes.length ? formatConfidence(visibleAverageConfidence) : "--"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Threshold (value)</span>
                  <span className="font-semibold text-foreground">
                    {results.thresholdValue.toFixed(0)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Preview size</span>
                  <span className="font-semibold text-foreground">
                    {results.previewWidth} x {results.previewHeight} px
                  </span>
                </div>
                {activeBox && (
                  <div className="pt-3 border-t border-cyan-500/20 space-y-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-cyan-300">
                      Selected Detection
                    </h4>
                    <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                      <span>Category</span>
                      <span className="text-foreground text-right flex items-center justify-end gap-2">
                        {activeCategory && (
                          <span
                            className="w-2.5 h-2.5 rounded-full"
                            style={{ backgroundColor: activeCategory.accent }}
                          />
                        )}
                        {activeBox.label}
                      </span>
                      <span>Confidence</span>
                      <span className="text-foreground text-right">
                        {formatConfidence(activeBox.confidence)}
                      </span>
                      <span>Area</span>
                      <span className="text-foreground text-right">

                        {formatArea(activeBox.areaPixels, results.pixelScale)}

                      </span>

                      <span>Coordinates</span>
                      <span className="text-foreground text-right">
                        {`(${Math.round(activeBox.bbox.x)}, ${Math.round(activeBox.bbox.y)})`}
                      </span>
                    </div>
                    {activeBox.notes && (
                      <p className="text-xs text-muted-foreground leading-snug">
                        {activeBox.notes}
                      </p>
                    )}
                  </div>
                )}
                {semanticInsights && (

                  <div className="pt-3 border-t border-cyan-500/20 space-y-2">

                    <h4 className="text-xs font-semibold uppercase tracking-wide text-cyan-300">

                      Semantic Labels

                    </h4>

                    <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">

                      <span>Total classes</span>

                      <span className="text-foreground text-right">

                        {semanticInsights.totalClasses}

                      </span>

                      <span>Collected samples</span>

                      <span className="text-foreground text-right">

                        {semanticInsights.totalSamples}

                      </span>

                      <span>Coverage (visible)</span>

                      <span className="text-foreground text-right">

                        {semanticInsights.totalCoverage.toFixed(1)}%

                      </span>

                      <span>Avg confidence</span>

                      <span className="text-foreground text-right">

                        {semanticInsights.averageConfidence.toFixed(1)}%

                      </span>

                    </div>

                    {topSemanticLabels.length > 0 && (

                      <div className="flex flex-wrap gap-2">

                        {topSemanticLabels.map((label) => (

                          <Badge

                            key={label.id}

                            variant="outline"

                            style={{ borderColor: label.color, color: label.color }}

                          >

                            {label.name} - {label.coverage.toFixed(1)}%

                          </Badge>

                        ))}

                      </div>

                    )}

                  </div>

                )}

              </CardContent>

            </Card>

          )}



          {results && (

            <Card className="glass-card">

              <CardHeader>

                <CardTitle className="text-cyan-400 text-lg">Exports</CardTitle>

              </CardHeader>

              <CardContent className="grid grid-cols-3 gap-3">

                <Button

                  variant="outline"

                  className="neon-button"

                  onClick={() => handleExport("json")}

                >

                  <Download className="mr-2 h-4 w-4" /> JSON

                </Button>

                <Button

                  variant="outline"

                  className="neon-button"

                  onClick={() => handleExport("csv")}

                >

                  <Download className="mr-2 h-4 w-4" /> CSV

                </Button>

                <Button

                  variant="outline"

                  className="neon-button"

                  onClick={() => handleExport("geojson")}

                >

                  <Download className="mr-2 h-4 w-4" /> GeoJSON

                </Button>

                <Button

                  variant="outline"

                  className="col-span-3 neon-button"

                  onClick={() => {

                    if (!results) return;

                    const link = document.createElement("a");

                    link.href = results.overlayUrl;

                    link.download = "sar_detection_overlay.png";

                    document.body.appendChild(link);

                    link.click();

                    document.body.removeChild(link);

                  }}

                >

                  <Download className="mr-2 h-4 w-4" /> Overlay PNG

                </Button>

                {hasSemanticBundle && (

                  <p className="col-span-3 text-xs text-muted-foreground">

                    Bundled exports include {bundleSampleTotal} semantic sample

                    {bundleSampleTotal === 1 ? "" : "s"}

                    {bundleLabelTotal > 0 && (

                      <>

                        {" "}across {bundleLabelTotal} label class

                        {bundleLabelTotal === 1 ? "" : "es"}

                      </>

                    )}

                    .

                  </p>

                )}

              </CardContent>

            </Card>

          )}

        </div>



        <div className="lg:col-span-2">

          <Card className="hologram-card">

            <CardContent>{renderPreview()}</CardContent>

          </Card>

        </div>

      </div>

    </div>

  );

};



export default ObjectDetectionPanel;









