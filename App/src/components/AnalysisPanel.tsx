import React, { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { AlertCircle, Play, Settings, Sliders, Download } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { analyzeChange, ChangeDetectionOptions, PostProcessOptions } from "@/lib/analysis";

type AlgorithmKey = ChangeDetectionOptions["algorithm"];

const ALGORITHM_LABELS: Record<AlgorithmKey, string> = {
  otsu: "Otsu Thresholding",
  kmeans: "K-Means Clustering",
  adaptive: "Adaptive Threshold",
  isolation_forest: "Isolation Forest",
  lof: "Local Outlier Factor",
  pca: "PCA Anomaly",
};

const getAlgorithmLabel = (key: AlgorithmKey): string => ALGORITHM_LABELS[key] ?? key;

interface AnalysisSummary {
  beforeImage: File;
  afterImage: File;
  beforeFileName: string;
  afterFileName: string;
  beforePreviewUrl: string;
  afterPreviewUrl: string;
  beforePreview: string;
  afterPreview: string;
  diffPreview: string;
  overlayPreview: string;
  maskPreview: string;
  width: number;
  height: number;
  changedPixels: number;
  changePercentage: number;
  changeAreaKm2: number | null;
  algorithm: AlgorithmKey;
  algorithmLabel: string;
  speckleFilter: string;
  bounds: [number, number, number, number] | null;
  coordinates: { lat: number; lng: number };
  timestamp: string;
  mapOverlays: {
    before: string;
    after: string;
    changeMask: string;
    overlay: string;
    diff: string;
  };
  changeDetection: {
    changedPixels: number;
    changePercentage: number;
    changeAreaKm2: number | null;
    algorithm: string;
    maskUrl: string;
  };
  parameters: {
    otsu: { threshold: number };
    kmeans: { clusters: number; iterations: number };
    ai: { contamination: number; estimators: number };
    postProcessing: PostProcessOptions;
  };
  confidence: number;
}


interface AnalysisPanelProps {
  beforeImage?: File | null;
  afterImage?: File | null;
  onAnalysisComplete?: (results: any) => void;
  onAOISelected?: (aoi: any) => void;
}

const AnalysisPanel = ({
  beforeImage = null,
  afterImage = null,
  onAnalysisComplete = () => {},
  onAOISelected = () => {},
}: AnalysisPanelProps) => {
  const [algorithm, setAlgorithm] = useState<string>("otsu");
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [results, setResults] = useState<AnalysisSummary | null>(null);
  const [error, setError] = useState<string>("");
  const [speckleFilter, setSpeckleFilter] = useState<string>("lee");
  const [speckleSize, setSpeckleSize] = useState<number>(5);

  // Algorithm specific parameters
  const [otsuParams, setOtsuParams] = useState({
    threshold: 0.5,
  });

  const [kmeansParams, setKmeansParams] = useState({
    clusters: 2,
    iterations: 10,
  });

  const [aiParams, setAiParams] = useState({
    contamination: 0.01,
    estimators: 100,
  });

  // Post-processing parameters
  const [postProcessParams, setPostProcessParams] = useState({
    openingRadius: 0,
    closingRadius: 2,
    fillHoles: true,
    minBlobArea: 80,
  });

  const fetchImageBlob = useCallback(async (sourceUrl: string) => {
    const response = await fetch(sourceUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status}`);
    }
    return await response.blob();
  }, []);

  const convertBlobToFormat = useCallback(
    async (blob: Blob, format: "png" | "jpg") => {
      if (typeof window === "undefined") {
        return blob;
      }

      if (format === "png" && blob.type === "image/png") {
        return blob;
      }

      const objectUrl = URL.createObjectURL(blob);

      try {
        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = objectUrl;
        });

        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth || image.width;
        canvas.height = image.naturalHeight || image.height;

        const context = canvas.getContext("2d");
        if (!context) {
          throw new Error("Unable to get canvas context for image conversion");
        }

        context.drawImage(image, 0, 0);

        const mimeType = format === "jpg" ? "image/jpeg" : "image/png";
        const quality = format === "jpg" ? 0.92 : undefined;

        const convertedBlob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (result) => {
              if (result) {
                resolve(result);
              } else {
                reject(new Error("Failed to convert image blob"));
              }
            },
            mimeType,
            quality,
          );
        });

        return convertedBlob;
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    },
    [],
  );

  const downloadBlob = useCallback((blob: Blob, filename: string) => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = filename;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(blobUrl);
  }, []);

  const getSanitizedBaseName = (filename: string, fallback: string) => {
    const trimmed = filename.trim();
    const base = trimmed ? trimmed.replace(/\.[^/.]+$/, "") : fallback;
    return base || fallback;
  };

  const downloadImageInFormats = useCallback(
    async (url: string, filename: string, formats: Array<"png" | "jpg">) => {
      if (!url || typeof window === "undefined") {
        return;
      }

      try {
        const baseName = getSanitizedBaseName(filename, "analysis-image");
        const sourceBlob = await fetchImageBlob(url);

        for (const format of formats) {
          const blobForFormat = await convertBlobToFormat(sourceBlob, format);
          const extension = format === "jpg" ? ".jpg" : ".png";
          downloadBlob(blobForFormat, `${baseName}${extension}`);
        }
      } catch (error) {
        console.error("Failed to download image in requested formats", error);
        if (typeof window !== "undefined" && typeof document !== "undefined") {
          const fallbackName = getSanitizedBaseName(filename, "analysis-image");
          const link = document.createElement("a");
          link.href = url;
          link.download = `${fallbackName}.jpg`;
          link.rel = "noopener";
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        }
      }
    },
    [convertBlobToFormat, downloadBlob, fetchImageBlob],
  );

  const handleDownloadImage = useCallback(
    (url: string, filename: string) => {
      void downloadImageInFormats(url, filename, ["jpg"]);
    },
    [downloadImageInFormats],
  );

  const handleDownloadPrimaryImage = useCallback(
    (url: string, filename: string) => {
      void downloadImageInFormats(url, filename, ["jpg"]);
    },
    [downloadImageInFormats],
  );

  const handleDownloadAllImages = useCallback(() => {
    if (!results) {
      return;
    }

    void (async () => {
      await downloadImageInFormats(
        results.beforePreviewUrl,
        results.beforeFileName || "before-image",
        ["jpg"],
      );
      await downloadImageInFormats(
        results.afterPreviewUrl,
        results.afterFileName || "after-image",
        ["jpg"],
      );
      await downloadImageInFormats(results.overlayPreview, "overlay-visualization", ["jpg"]);
      await downloadImageInFormats(results.diffPreview, "change-detection", ["jpg"]);
    })();
  }, [results, downloadImageInFormats]);

  // Reset results when images change
  useEffect(() => {
    setResults(null);
  }, [beforeImage, afterImage]);

  const runAnalysis = useCallback(async () => {
    if (!beforeImage || !afterImage) {
      setError("Please upload both before and after images first");
      return;
    }

    setError("");
    setIsProcessing(true);
    setProgress(5);

    try {
      const algorithmValue: AlgorithmKey = (() => {
        if (algorithm === "kmeans") return "kmeans";
        if (algorithm === "adaptive") return "adaptive";
        if (algorithm === "isolation_forest" || algorithm === "ai") return "isolation_forest";
        if (algorithm === "lof") return "lof";
        if (algorithm === "pca") return "pca";
        return "otsu";
      })();

      const options: ChangeDetectionOptions = {
        algorithm: algorithmValue,
        kmeansClusters: kmeansParams.clusters,
        kmeansIterations: kmeansParams.iterations,
        contamination: aiParams.contamination,
        isolationTrees: aiParams.estimators,
        otsuManualThreshold: otsuParams.threshold,
        speckleFilter: (speckleFilter as ChangeDetectionOptions["speckleFilter"]) ?? "none",
        speckleSize,
        postProcess: postProcessParams,
      };

      setProgress(20);
      const result = await analyzeChange(beforeImage, afterImage, options);
      setProgress(80);

      const bounds = result.bounds ?? null;
      const coordinates = bounds
        ? {
            lng: (bounds[0] + bounds[2]) / 2,
            lat: (bounds[1] + bounds[3]) / 2,
          }
        : { lat: 40.7128, lng: -74.006 };

      const algorithmLabel = getAlgorithmLabel(algorithmValue);
      const confidence = Math.max(0, Math.min(100, 100 - result.changePercentage));

      const analysisSummary: AnalysisSummary = {
        beforeImage,
        afterImage,
        beforeFileName: beforeImage.name,
        afterFileName: afterImage.name,
        beforePreviewUrl: result.preview.beforePreviewUrl,
        afterPreviewUrl: result.preview.afterPreviewUrl,
        beforePreview: result.preview.beforePreviewUrl,
        afterPreview: result.preview.afterPreviewUrl,
        diffPreview: result.preview.diffHeatmapUrl,
        overlayPreview: result.preview.overlayUrl,
        maskPreview: result.preview.maskPreviewUrl,
        width: result.originalWidth,
        height: result.originalHeight,
        changedPixels: result.changedPixels,
        changePercentage: Number(result.changePercentage.toFixed(2)),
        changeAreaKm2: result.changeAreaKm2 ?? null,
        algorithm: algorithmValue,
        algorithmLabel,
        speckleFilter,
        bounds,
        coordinates,
        timestamp: new Date().toISOString(),
        mapOverlays: {
          before: result.preview.beforePreviewUrl,
          after: result.preview.afterPreviewUrl,
          changeMask: result.preview.overlayUrl,
          overlay: result.preview.overlayUrl,
          diff: result.preview.diffHeatmapUrl,
        },
        changeDetection: {
          changedPixels: result.changedPixels,
          changePercentage: Number(result.changePercentage.toFixed(2)),
          changeAreaKm2: result.changeAreaKm2 ?? null,
          algorithm: algorithmLabel,
          maskUrl: result.preview.maskPreviewUrl,
        },
        parameters: {
          otsu: { threshold: otsuParams.threshold },
          kmeans: { clusters: kmeansParams.clusters, iterations: kmeansParams.iterations },
          ai: { contamination: aiParams.contamination, estimators: aiParams.estimators },
          postProcessing: postProcessParams,
        },
        confidence,
      };

      setResults(analysisSummary);
      onAnalysisComplete(analysisSummary);
      if (bounds) {
        onAOISelected(bounds);
      }
      setProgress(100);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Analysis failed. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  }, [
    beforeImage,
    afterImage,
    algorithm,
    aiParams.contamination,
    aiParams.estimators,
    kmeansParams.clusters,
    kmeansParams.iterations,
    otsuParams.threshold,
    speckleFilter,
    speckleSize,
    postProcessParams,
    onAnalysisComplete,
    onAOISelected,
  ]);


  return (
    <Card className="w-full glass-card h-[925px]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-orbitron">
          <Sliders className="h-5 w-5 text-primary neon-glow" />
          <span className="neon-text">SAR Change Detection Analysis</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="overflow-y-auto h-[810.4278485996838px]">
        {error && (
          <Alert variant="destructive" className="mb-4 glass-card">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1">
            <div className="space-y-6">
              <div className="glass-card p-4 rounded-lg">
                <h3 className="text-lg font-medium mb-2 font-orbitron text-primary">
                  Algorithm Selection
                </h3>
                <Select value={algorithm} onValueChange={setAlgorithm}>
                  <SelectTrigger className="glass-card">
                    <SelectValue placeholder="Select algorithm" />
                  </SelectTrigger>
                  <SelectContent className="glass-card">
                    <SelectItem value="otsu">Otsu Thresholding</SelectItem>
                    <SelectItem value="kmeans">K-Means Clustering</SelectItem>
                    <SelectItem value="adaptive">Adaptive Threshold</SelectItem>
                    <SelectItem value="isolation_forest">Isolation Forest</SelectItem>
                    <SelectItem value="lof">Local Outlier Factor</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="glass-card p-4 rounded-lg">
                <h3 className="text-lg font-medium mb-2 font-orbitron text-primary">
                  Speckle Filter
                </h3>
                <Select value={speckleFilter} onValueChange={setSpeckleFilter}>
                  <SelectTrigger className="glass-card">
                    <SelectValue placeholder="Select filter" />
                  </SelectTrigger>
                  <SelectContent className="glass-card">
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="lee">Lee</SelectItem>
                    <SelectItem value="kuan">Kuan</SelectItem>
                    <SelectItem value="frost">Frost</SelectItem>
                  </SelectContent>
                </Select>

                {speckleFilter !== "none" && (
                  <div className="mt-4">
                    <Label htmlFor="speckleSize">
                      Window Size: {speckleSize}
                    </Label>
                    <Slider
                      id="speckleSize"
                      min={3}
                      max={15}
                      step={2}
                      value={[speckleSize]}
                      onValueChange={(value) => setSpeckleSize(value[0])}
                      className="mt-2"
                    />
                  </div>
                )}
              </div>

              <Separator className="bg-gradient-to-r from-transparent via-primary/50 to-transparent" />

              <div>
                <h3 className="text-lg font-medium mb-2">
                  Algorithm Parameters
                </h3>

                {algorithm === "otsu" && (
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="threshold">
                        Threshold: {otsuParams.threshold}
                      </Label>
                      <Slider
                        id="threshold"
                        min={0}
                        max={1}
                        step={0.01}
                        value={[otsuParams.threshold]}
                        onValueChange={(value) =>
                          setOtsuParams({ ...otsuParams, threshold: value[0] })
                        }
                        className="mt-2"
                      />
                    </div>
                  </div>
                )}

                {algorithm === "kmeans" && (
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="clusters">Number of Clusters</Label>
                      <Select
                        value={kmeansParams.clusters.toString()}
                        onValueChange={(value) =>
                          setKmeansParams({
                            ...kmeansParams,
                            clusters: parseInt(value),
                          })
                        }
                      >
                        <SelectTrigger id="clusters">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="2">2</SelectItem>
                          <SelectItem value="3">3</SelectItem>
                          <SelectItem value="4">4</SelectItem>
                          <SelectItem value="5">5</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label htmlFor="iterations">
                        Max Iterations: {kmeansParams.iterations}
                      </Label>
                      <Slider
                        id="iterations"
                        min={5}
                        max={50}
                        step={1}
                        value={[kmeansParams.iterations]}
                        onValueChange={(value) =>
                          setKmeansParams({
                            ...kmeansParams,
                            iterations: value[0],
                          })
                        }
                        className="mt-2"
                      />
                    </div>
                  </div>
                )}

                {(algorithm === "isolation_forest" || algorithm === "lof" || algorithm === "pca") && (
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="contamination">
                        Contamination: {aiParams.contamination}
                      </Label>
                      <Slider
                        id="contamination"
                        min={0.001}
                        max={0.2}
                        step={0.001}
                        value={[aiParams.contamination]}
                        onValueChange={(value) =>
                          setAiParams({ ...aiParams, contamination: value[0] })
                        }
                        className="mt-2"
                      />
                    </div>

                    {(algorithm === "isolation_forest" || algorithm === "pca") && (
                      <div>
                        <Label htmlFor="estimators">
                          Number of Estimators: {aiParams.estimators}
                        </Label>
                        <Slider
                          id="estimators"
                          min={10}
                          max={300}
                          step={10}
                          value={[aiParams.estimators]}
                          onValueChange={(value) =>
                            setAiParams({ ...aiParams, estimators: value[0] })
                          }
                          className="mt-2"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>

              <Separator />

              <div>
                <h3 className="text-lg font-medium mb-2">Post-Processing</h3>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="openingRadius">
                      Opening Radius: {postProcessParams.openingRadius}
                    </Label>
                    <Slider
                      id="openingRadius"
                      min={0}
                      max={10}
                      step={1}
                      value={[postProcessParams.openingRadius]}
                      onValueChange={(value) =>
                        setPostProcessParams({
                          ...postProcessParams,
                          openingRadius: value[0],
                        })
                      }
                      className="mt-2"
                    />
                  </div>

                  <div>
                    <Label htmlFor="closingRadius">
                      Closing Radius: {postProcessParams.closingRadius}
                    </Label>
                    <Slider
                      id="closingRadius"
                      min={0}
                      max={10}
                      step={1}
                      value={[postProcessParams.closingRadius]}
                      onValueChange={(value) =>
                        setPostProcessParams({
                          ...postProcessParams,
                          closingRadius: value[0],
                        })
                      }
                      className="mt-2"
                    />
                  </div>

                  <div className="flex items-center space-x-2">
                    <Switch
                      id="fillHoles"
                      checked={postProcessParams.fillHoles}
                      onCheckedChange={(checked) =>
                        setPostProcessParams({
                          ...postProcessParams,
                          fillHoles: checked,
                        })
                      }
                    />
                    <Label htmlFor="fillHoles">Fill Holes</Label>
                  </div>

                  <div>
                    <Label htmlFor="minBlobArea">
                      Minimum Blob Area: {postProcessParams.minBlobArea}
                    </Label>
                    <Slider
                      id="minBlobArea"
                      min={5}
                      max={2000}
                      step={5}
                      value={[postProcessParams.minBlobArea]}
                      onValueChange={(value) =>
                        setPostProcessParams({
                          ...postProcessParams,
                          minBlobArea: value[0],
                        })
                      }
                      className="mt-2"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-4">
                <Button
                  onClick={runAnalysis}
                  disabled={isProcessing || !beforeImage || !afterImage}
                  className="w-full sci-fi-button font-orbitron"
                >
                  <Play className="mr-2 h-4 w-4" />
                  {isProcessing ? "Processing..." : "Run Analysis"}
                </Button>

                {isProcessing && (
                  <div className="mt-4">
                    <Progress value={progress} className="pulse-glow" />
                    <p className="text-center text-sm text-muted-foreground mt-2 font-orbitron">
                      Analyzing SAR imagery... {progress}%
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="lg:col-span-2">
            {results && (
              <div className="mt-2 space-y-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <h3 className="text-xl font-semibold text-cyan-400 glow-text">
                    Analysis Results
                  </h3>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-2 self-start sm:self-auto"
                    onClick={handleDownloadAllImages}
                  >
                    <Download className="h-4 w-4" />
                    Download All
                  </Button>
                </div>

                {/* Image Results Grid */}
                <div className="grid grid-cols-2 gap-6">
                  {/* Before Image */}
                  <div className="hologram-card p-4 rounded-lg">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <h4 className="text-lg font-medium text-foreground">
                        Before SAR Image: {results.beforeFileName}
                      </h4>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="gap-2"
                        onClick={() =>
                          handleDownloadPrimaryImage(
                            results.beforePreviewUrl,
                            results.beforeFileName || "before-image"
                          )
                        }
                      >
                        <Download className="h-4 w-4" />
                        Download JPG
                      </Button>
                    </div>
                    <div className="aspect-square bg-muted/20 rounded-lg overflow-hidden glow-border">
                      <img
                        src={results.beforePreviewUrl}
                        alt="Before SAR image"
                        className="w-full h-full object-cover"
                      />
                    </div>
                  </div>

                  {/* After Image */}
                  <div className="hologram-card p-4 rounded-lg">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <h4 className="text-lg font-medium text-foreground">
                        After SAR Image: {results.afterFileName}
                      </h4>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="gap-2"
                        onClick={() =>
                          handleDownloadPrimaryImage(
                            results.afterPreviewUrl,
                            results.afterFileName || "after-image"
                          )
                        }
                      >
                        <Download className="h-4 w-4" />
                        Download JPG
                      </Button>
                    </div>
                    <div className="aspect-square bg-muted/20 rounded-lg overflow-hidden glow-border">
                      <img
                        src={results.afterPreviewUrl}
                        alt="After SAR image"
                        className="w-full h-full object-cover"
                      />
                    </div>
                  </div>

                  {/* Difference Image */}
                  <div className="hologram-card p-4 rounded-lg">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <h4 className="text-lg font-medium text-cyan-400">
                        Change Detection
                      </h4>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="gap-2"
                        onClick={() =>
                          handleDownloadImage(
                            results.diffPreview,
                            "change-detection.png"
                          )
                        }
                      >
                        <Download className="h-4 w-4" />
                        Download
                      </Button>
                    </div>
                    <div className="aspect-square bg-muted/20 rounded-lg overflow-hidden glow-border">
                      <img
                        src={results.diffPreview}
                        alt="Change detection result"
                        className="w-full h-full object-cover"
                      />
                    </div>
                  </div>

                  {/* Overlay Image */}
                  <div className="hologram-card p-4 rounded-lg">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <h4 className="text-lg font-medium text-cyan-400">
                        Overlay Visualization
                      </h4>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="gap-2"
                        onClick={() =>
                          handleDownloadImage(
                            results.overlayPreview,
                            "overlay-visualization.png"
                          )
                        }
                      >
                        <Download className="h-4 w-4" />
                        Download
                      </Button>
                    </div>
                    <div className="aspect-square bg-muted/20 rounded-lg overflow-hidden glow-border">
                      <img
                        src={results.overlayPreview}
                        alt="Overlay visualization"
                        className="w-full h-full object-cover"
                      />
                    </div>
                  </div>
                </div>

                {/* Statistics */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="hologram-card p-4 rounded-lg text-center">
                    <div className="text-2xl font-bold text-cyan-400 glow-text">
                      {results.changedPixels.toLocaleString()}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Changed Pixels
                    </div>
                  </div>
                  <div className="hologram-card p-4 rounded-lg text-center">
                    <div className="text-2xl font-bold text-cyan-400 glow-text">
                      {results.changeAreaKm2 !== null ? results.changeAreaKm2.toFixed(3) : "N/A"} km^2
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Changed Area
                    </div>
                  </div>
                  <div className="hologram-card p-4 rounded-lg text-center">
                    <div className="text-2xl font-bold text-cyan-400 glow-text">
                      {results.algorithmLabel}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Algorithm Used
                    </div>
                  </div>
                </div>
              </div>
            )}

            {!results && (
              <div className="flex items-center justify-center h-full">
                <div className="text-center p-8 glass-card rounded-lg">
                  <Settings className="h-12 w-12 text-primary mx-auto mb-4 pulse-glow" />
                  <h3 className="text-lg font-medium font-orbitron holographic">
                    Configure Analysis Parameters
                  </h3>
                  <p className="text-muted-foreground mt-2 max-w-md">
                    Select an algorithm and configure its parameters, then click
                    "Run Analysis" to detect changes between the before and
                    after SAR images.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default AnalysisPanel;
