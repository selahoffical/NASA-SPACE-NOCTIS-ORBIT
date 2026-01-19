import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label as UiLabel } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  CircleMarker,
  ImageOverlay,
  MapContainer,
  Polygon,
  Polyline,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";
import { LatLngBounds } from "leaflet";
import "leaflet/dist/leaflet.css";
import { AnnotationGeometryType, LabelAnnotation, LabelExportPayload, LabelingSummary, SemanticLabel } from "@/types/semantic";
import { Download, Layers, MapPin, Palette, RefreshCw, Trash2, Wand2 } from "lucide-react";

interface SemanticLabelingPanelProps {
  areaOfInterest?: [number, number, number, number];
  analysisResults?: any;
  onLabelingComplete?: (summary: LabelingSummary) => void;
  onExportLabels?: (payload: LabelExportPayload) => void;
}

const LABEL_TEMPLATES: Array<{
  id: string;
  name: string;
  color: string;
  weight: number;
  description: string;
}> = [
  {
    id: "damage",
    name: "Structural Damage",
    color: "#f97316",
    weight: 0.32,
    description: "Collapsed or damaged infrastructure inferred from strong coherence loss.",
  },
  {
    id: "flooding",
    name: "Flooded Terrain",
    color: "#38bdf8",
    weight: 0.28,
    description: "Low-backscatter zones typical of standing water or inundation.",
  },
  {
    id: "vegetation-loss",
    name: "Vegetation Loss",
    color: "#84cc16",
    weight: 0.22,
    description: "Deforested or scorched areas with altered polarimetric response.",
  },
  {
    id: "new-build",
    name: "New Construction",
    color: "#a855f7",
    weight: 0.18,
    description: "Emergent man-made structures or resurfaced zones.",
  },
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function createInitialLabels(changePercent?: number | null): SemanticLabel[] {
  const basePercent = Number.isFinite(changePercent)
    ? clamp(changePercent as number, 5, 100)
    : 35;
  const totalWeight = LABEL_TEMPLATES.reduce((acc, template) => acc + template.weight, 0);

  return LABEL_TEMPLATES.map((template) => {
    const scaledCoverage = (basePercent * template.weight) / totalWeight;
    const coverage = Number(scaledCoverage.toFixed(1));
    const confidenceSource = changePercent ?? 40;
    const confidence = Math.round(clamp(45 + confidenceSource * template.weight, 35, 98));

    return {
      id: template.id,
      name: template.name,
      color: template.color,
      coverage,
      confidence,
      description: template.description,
      visible: true,
    };
  });
}

function createId(): string {
  return "ann-" + Math.random().toString(36).slice(2, 10);
}

type DrawingMode = "point" | "polygon" | "rectangle";

const createRectangleFromCorners = (
  start: [number, number],
  end: [number, number],
): Array<[number, number]> => {
  const [startLat, startLng] = start;
  const [endLat, endLng] = end;

  return [
    [startLat, startLng],
    [startLat, endLng],
    [endLat, endLng],
    [endLat, startLng],
  ];
};

const POLYGON_CLOSE_TOLERANCE = 0.0004;

const isPointNear = (
  target: [number, number],
  candidate: [number, number],
  tolerance = POLYGON_CLOSE_TOLERANCE,
): boolean => {
  const [targetLat, targetLng] = target;
  const [candidateLat, candidateLng] = candidate;
  const dLat = targetLat - candidateLat;
  const dLng = targetLng - candidateLng;
  return Math.sqrt(dLat * dLat + dLng * dLng) <= tolerance;
};

const FitBounds: React.FC<{ bounds: LatLngBounds | null }> = ({ bounds }) => {
  const map = useMap();

  useEffect(() => {
    if (bounds) {
      map.fitBounds(bounds, { animate: false, padding: [20, 20] });
    }
  }, [bounds, map]);

  return null;
};

const AnnotationCapture: React.FC<{
  onMapClick: (lat: number, lng: number) => void;
  onCursorMove: (lat: number, lng: number) => void;
}> = ({ onMapClick, onCursorMove }) => {
  useMapEvents({
    click(event) {
      onMapClick(event.latlng.lat, event.latlng.lng);
    },
    mousemove(event) {
      onCursorMove(event.latlng.lat, event.latlng.lng);
    },
  });

  return null;
};

const SemanticLabelingPanel: React.FC<SemanticLabelingPanelProps> = ({
  areaOfInterest,
  analysisResults,
  onLabelingComplete,
  onExportLabels,
}) => {
  const changePercent = typeof analysisResults?.changeDetection?.changePercentage === "number"
    ? analysisResults.changeDetection.changePercentage
    : typeof analysisResults?.changePercentage === "number"
      ? analysisResults.changePercentage
      : null;

  const changeAreaKm2 = typeof analysisResults?.changeDetection?.changeAreaKm2 === "number"
    ? analysisResults.changeDetection.changeAreaKm2
    : typeof analysisResults?.changeAreaKm2 === "number"
      ? analysisResults.changeAreaKm2
      : null;

  const detectionConfidence = typeof analysisResults?.confidence === "number"
    ? clamp(analysisResults.confidence, 0, 100)
    : changePercent !== null
      ? clamp(100 - changePercent, 0, 100)
      : null;

  const initialLabelData = useMemo(
    () => createInitialLabels(changePercent),
    [changePercent],
  );

  const [labels, setLabels] = useState<SemanticLabel[]>(() =>
    initialLabelData.map((label) => ({ ...label })),
  );
  const [annotations, setAnnotations] = useState<LabelAnnotation[]>([]);
  const [activeLabelId, setActiveLabelId] = useState<string | null>(
    initialLabelData[0]?.id ?? null,
  );
  const [overlayMode, setOverlayMode] = useState<string>("change-mask");
  const [overlayOpacity, setOverlayOpacity] = useState<number>(70);
  const [showAnnotations, setShowAnnotations] = useState<boolean>(true);
  const [drawingMode, setDrawingMode] = useState<DrawingMode>("point");
  const [pendingPolygon, setPendingPolygon] = useState<Array<[number, number]>>([]);
  const [pendingRectangleStart, setPendingRectangleStart] = useState<[number, number] | null>(null);
  const [pendingLabelId, setPendingLabelId] = useState<string | null>(null);
  const [cursorPosition, setCursorPosition] = useState<[number, number] | null>(null);

  useEffect(() => {
    setLabels(initialLabelData.map((label) => ({ ...label })));
    setActiveLabelId(initialLabelData[0]?.id ?? null);
    setAnnotations([]);
    setDrawingMode("point");
    setPendingPolygon([]);
    setPendingRectangleStart(null);
    setPendingLabelId(null);
    setCursorPosition(null);
  }, [initialLabelData]);
  useEffect(() => {
    if (!onLabelingComplete) return;
    const summary: LabelingSummary = {
      labels: labels.map((label) => ({ ...label })),
      annotations: annotations.map((annotation) => ({ ...annotation })),
      updatedAt: new Date().toISOString(),
    };
    onLabelingComplete(summary);
  }, [annotations, labels, onLabelingComplete]);

  useEffect(() => {
    setPendingPolygon([]);
    setPendingRectangleStart(null);
    setPendingLabelId(null);
    setCursorPosition(null);
  }, [drawingMode]);

  const boundsArray = useMemo<[number, number, number, number] | null>(() => {
    if (Array.isArray(analysisResults?.bounds) && analysisResults.bounds.length === 4) {
      return analysisResults.bounds as [number, number, number, number];
    }
    if (Array.isArray(areaOfInterest) && areaOfInterest.length === 4) {
      return areaOfInterest;
    }
    return null;
  }, [analysisResults, areaOfInterest]);

  const mapBounds = useMemo(() => {
    if (boundsArray) {
      const [west, south, east, north] = boundsArray;
      return new LatLngBounds([south, west], [north, east]);
    }
    return new LatLngBounds([40.69, -74.05], [40.74, -73.95]);
  }, [boundsArray]);

  const fallbackLat = typeof analysisResults?.coordinates?.lat === "number"
    ? analysisResults.coordinates.lat
    : 40.7128;
  const fallbackLng = typeof analysisResults?.coordinates?.lng === "number"
    ? analysisResults.coordinates.lng
    : -74.006;

  const mapCenter = useMemo<[number, number]>(() => {
    if (boundsArray) {
      const [west, south, east, north] = boundsArray;
      return [(south + north) / 2, (west + east) / 2];
    }
    return [fallbackLat, fallbackLng];
  }, [boundsArray, fallbackLat, fallbackLng]);

  const samplesByLabel = useMemo(() => {
    const counts = new Map<string, number>();
    annotations.forEach((annotation) => {
      counts.set(annotation.labelId, (counts.get(annotation.labelId) ?? 0) + 1);
    });
    return counts;
  }, [annotations]);

  const overlayUrl = useMemo(() => {
    if (!analysisResults) return null;

    const changeMask =
      analysisResults?.changeDetection?.maskUrl ??
      analysisResults?.mapOverlays?.changeMask ??
      analysisResults?.maskPreview ??
      null;

    const diffHeatmap =
      analysisResults?.mapOverlays?.diff ??
      analysisResults?.diffPreview ??
      null;

    const beforeImage =
      analysisResults?.mapOverlays?.before ??
      analysisResults?.beforePreview ??
      analysisResults?.beforePreviewUrl ??
      null;

    const afterImage =
      analysisResults?.mapOverlays?.after ??
      analysisResults?.afterPreview ??
      analysisResults?.afterPreviewUrl ??
      null;

    const compositeOverlay =
      analysisResults?.mapOverlays?.overlay ??
      changeMask;

    switch (overlayMode) {
      case "diff-heatmap":
        return diffHeatmap;
      case "before":
        return beforeImage;
      case "after":
        return afterImage;
      case "change-mask":
      default:
        return compositeOverlay;
    }
  }, [analysisResults, overlayMode]);

  const activeLabel = labels.find((label) => label.id === activeLabelId) ?? null;
  const drawingLabel = labels.find((label) => label.id === (pendingLabelId ?? activeLabelId)) ?? null;
  const drawingColor = drawingLabel?.color ?? "#ffffff";
  const canCompletePolygon = pendingPolygon.length >= 3;
  const drawingInstructions = (() => {
    if (!drawingLabel) {
      return "Select a label to start annotating.";
    }

    if (drawingMode === "point") {
      return "Click map to add point samples.";
    }

    if (drawingMode === "polygon") {
      if (pendingPolygon.length > 0) {
        return `${pendingPolygon.length} vertices placed. Add points or click the first vertex to close.`;
      }
      return "Click map to add polygon vertices.";
    }

    if (pendingRectangleStart) {
      return "Click opposite corner to finish the rectangle.";
    }

    return "Click map to set the first corner, then the opposite corner.";
  })();
  const totalVisibleCoverage = labels
    .filter((label) => label.visible)
    .reduce((acc, label) => acc + label.coverage, 0);
  const totalSamples = annotations.length;
  const hasResults = Boolean(analysisResults);

  const handleCoverageChange = (labelId: string, nextValue: number) => {
    setLabels((prev) =>
      prev.map((label) =>
        label.id === labelId
          ? { ...label, coverage: Number(nextValue.toFixed(1)) }
          : label,
      ),
    );
  };

  const handleConfidenceChange = (labelId: string, nextValue: number) => {
    setLabels((prev) =>
      prev.map((label) =>
        label.id === labelId
          ? { ...label, confidence: Math.round(nextValue) }
          : label,
      ),
    );
  };

  const handleVisibilityToggle = (labelId: string, visible: boolean) => {
    setLabels((prev) =>
      prev.map((label) =>
        label.id === labelId
          ? { ...label, visible }
          : label,
      ),
    );
  };

  const handleLabelNameChange = (labelId: string, name: string) => {
    setLabels((prev) =>
      prev.map((label) =>
        label.id === labelId
          ? { ...label, name }
          : label,
      ),
    );
  };

  const handleColorChange = (labelId: string, color: string) => {
    setLabels((prev) =>
      prev.map((label) =>
        label.id === labelId
          ? { ...label, color }
          : label,
      ),
    );
  };

  const clearPendingShape = () => {
    setPendingPolygon([]);
    setPendingRectangleStart(null);
    setPendingLabelId(null);
    setCursorPosition(null);
  };

  const addAnnotation = (
    labelId: string,
    geometryType: AnnotationGeometryType,
    coords: Array<[number, number]>,
  ) => {
    if (!coords.length) {
      return;
    }

    setAnnotations((prev) => [
      ...prev,
      {
        id: createId(),
        labelId,
        geometryType,
        coordinates: coords.map(([latValue, lngValue]) => [latValue, lngValue]),
        createdAt: new Date().toISOString(),
      },
    ]);
  };

  const handleMapClick = (lat: number, lng: number) => {
    if (!activeLabelId && !pendingLabelId) {
      return;
    }

    const targetLabelId = pendingLabelId ?? activeLabelId;
    if (!targetLabelId) {
      return;
    }

    if (drawingMode === "point") {
      addAnnotation(targetLabelId, "point", [[lat, lng]]);
      return;
    }

    if (drawingMode === "polygon") {
      const newVertex: [number, number] = [lat, lng];

      if (!pendingPolygon.length) {
        setPendingLabelId(targetLabelId);
        setPendingPolygon([newVertex]);
        return;
      }

      const firstVertex = pendingPolygon[0];
      const canAttemptClose = pendingPolygon.length >= 3;
      const shouldClose = canAttemptClose && isPointNear(firstVertex, newVertex);

      if (shouldClose) {
        const polygonVertices = [...pendingPolygon];
        addAnnotation(targetLabelId, "polygon", polygonVertices);
        clearPendingShape();
        return;
      }

      setPendingPolygon((prev) => [...prev, newVertex]);
      return;
    }

    if (drawingMode === "rectangle") {
      if (!pendingRectangleStart) {
        setPendingRectangleStart([lat, lng]);
        setPendingLabelId(targetLabelId);
      } else {
        const rectangleLabelId = pendingLabelId ?? targetLabelId;
        const corners = createRectangleFromCorners(pendingRectangleStart, [lat, lng]);
        addAnnotation(rectangleLabelId, "rectangle", corners);
        clearPendingShape();
      }
    }
  };

  const handleCursorMove = (lat: number, lng: number) => {
    if (drawingMode === "polygon" && pendingPolygon.length > 0) {
      setCursorPosition([lat, lng]);
      return;
    }

    if (drawingMode === "rectangle" && pendingRectangleStart) {
      setCursorPosition([lat, lng]);
      return;
    }

    if (cursorPosition !== null) {
      setCursorPosition(null);
    }
  };

  const handleCompletePolygon = () => {
    if (drawingMode !== "polygon" || pendingPolygon.length < 3) {
      return;
    }
    const targetLabelId = pendingLabelId ?? activeLabelId;
    if (!targetLabelId) {
      return;
    }

    addAnnotation(targetLabelId, "polygon", pendingPolygon);
    clearPendingShape();
  };

  const handleUndoLastVertex = () => {
    if (drawingMode !== "polygon" || pendingPolygon.length === 0) {
      return;
    }

    setPendingPolygon((prev) => {
      const next = prev.slice(0, -1);
      if (next.length === 0) {
        setPendingLabelId(null);
        setCursorPosition(null);
      }
      return next;
    });
  };

  const handleCancelPendingShape = () => {
    if (pendingPolygon.length || pendingRectangleStart || cursorPosition) {
      clearPendingShape();
    }
  };



  const handleRemoveAnnotation = (annotationId: string) => {
    setAnnotations((prev) => prev.filter((annotation) => annotation.id !== annotationId));
  };

  const handleExportAnnotations = () => {
    if (!annotations.length) return;

    const features = annotations.map((annotation) => {
      const label = labels.find((item) => item.id === annotation.labelId);

      if (annotation.geometryType === "point") {
        const [lat, lng] = annotation.coordinates[0];
        return {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [lng, lat],
          },
          properties: {
            labelId: annotation.labelId,
            labelName: label?.name ?? "Unknown",
            color: label?.color ?? "#ffffff",
            createdAt: annotation.createdAt,
            geometryType: annotation.geometryType,
            vertexCount: annotation.coordinates.length,
          },
        };
      }

      const ring = annotation.coordinates.map(([latValue, lngValue]) => {
        return [lngValue, latValue] as [number, number];
      });

      if (ring.length > 0) {
        const [firstLng, firstLat] = ring[0];
        const [lastLng, lastLat] = ring[ring.length - 1];
        if (firstLng !== lastLng || firstLat !== lastLat) {
          ring.push([firstLng, firstLat]);
        }
      }

      return {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [ring],
        },
        properties: {
          labelId: annotation.labelId,
          labelName: label?.name ?? "Unknown",
          color: label?.color ?? "#ffffff",
          createdAt: annotation.createdAt,
          geometryType: annotation.geometryType,
          vertexCount: annotation.coordinates.length,
        },
      };
    });

    const geojson = {
      type: "FeatureCollection",
      features,
    } as LabelExportPayload["geojson"];

    const payload: LabelExportPayload = {
      format: "geojson",
      labels: labels.map((label) => ({ ...label })),
      annotations: annotations.map((annotation) => ({ ...annotation })),
      updatedAt: new Date().toISOString(),
      geojson,
    };

    const blob = new Blob([JSON.stringify(geojson, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "semantic_label_samples.geojson";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    if (onExportLabels) {
      onExportLabels(payload);
    }
  };



  const handleAutoLabel = () => {
    const total = Number.isFinite(changePercent)
      ? clamp(changePercent as number, 5, 100)
      : labels.reduce((sum, label) => sum + label.coverage, 0) || 35;

    const weightMap = LABEL_TEMPLATES.reduce<Record<string, number>>((acc, template) => {
      acc[template.id] = template.weight;
      return acc;
    }, {});
    const totalWeight = Object.values(weightMap).reduce((acc, value) => acc + value, 0);

    setLabels((prev) =>
      prev.map((label) => {
        const weight = weightMap[label.id] ?? (1 / Math.max(prev.length, 1));
        const coverage = Number(((total * weight) / totalWeight).toFixed(1));
        const confidence = Math.round(
          clamp(55 + (changePercent ?? 40) * weight, 40, 98),
        );
        return {
          ...label,
          coverage,
          confidence,
        };
      }),
    );
  };

  const handleReset = () => {
    setLabels(initialLabelData.map((label) => ({ ...label })));
    setAnnotations([]);
    setActiveLabelId(initialLabelData[0]?.id ?? null);
    setOverlayMode("change-mask");
    setOverlayOpacity(70);
    setDrawingMode("point");
    clearPendingShape();
  };

  return (
    <Card className="glass-card w-full">
      <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <CardTitle className="text-2xl font-orbitron text-cyan-400">
            Semantic Labeling Workspace
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Assign contextual classes to detected change regions, drop ground-truth samples, and export labeled evidence.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={handleAutoLabel}
            disabled={!hasResults}
            className="neon-button"
          >
            <Wand2 className="mr-2 h-4 w-4" />
            Auto infer labels
          </Button>
          <Button
            variant="outline"
            onClick={handleReset}
            className="neon-button"
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Reset workspace
          </Button>
          <Button
            onClick={handleExportAnnotations}
            disabled={!annotations.length}
            className="neon-button"
          >
            <Download className="mr-2 h-4 w-4" />
            Export samples
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!hasResults && (
          <Alert className="mb-6">
            <AlertDescription>
              Run a change analysis to unlock semantic labeling suggestions and overlays.
              You can still sketch labels and samples, but automatic estimates will be unavailable.
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <div className="space-y-6">
            <div className="glass-card rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-cyan-300">
                  Scene Summary
                </h3>
                {activeLabel && (
                  <Badge variant="outline" className="bg-cyan-500/10 text-cyan-300">
                    <span className="mr-1">Active:</span> {activeLabel.name}
                  </Badge>
                )}
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span>Change coverage</span>
                  <span className="font-semibold text-foreground">
                    {changePercent !== null ? changePercent.toFixed(2) + "%" : "N/A"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Estimated area</span>
                  <span className="font-semibold text-foreground">
                    {changeAreaKm2 !== null ? changeAreaKm2.toFixed(3) + " km^2" : "N/A"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Confidence</span>
                  <span className="font-semibold text-foreground">
                    {detectionConfidence !== null ? detectionConfidence.toFixed(0) + "%" : "N/A"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Collected samples</span>
                  <span className="font-semibold text-foreground">{totalSamples}</span>
                </div>
              </div>
              <div>
                <UiLabel className="text-xs text-muted-foreground">
                  Coverage Balance (visible labels)
                </UiLabel>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div className="flex h-full w-full">
                    {labels.filter((label) => label.visible).map((label) => (
                      <div
                        key={label.id}
                        style={{
                          width: label.coverage + "%",
                          backgroundColor: label.color,
                        }}
                        className="h-full"
                      />
                    ))}
                  </div>
                </div>
                <div className="mt-1 text-right text-xs text-muted-foreground">
                  {totalVisibleCoverage.toFixed(1)}% of AOI represented
                </div>
              </div>
            </div>

            <div className="glass-card rounded-lg p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Palette className="h-4 w-4 text-cyan-400" /> Label Library
                </h3>
                <Badge variant="outline" className="text-xs text-muted-foreground">
                  Click a label to arm sampling
                </Badge>
              </div>

              <div className="space-y-4">
                {labels.map((label) => {
                  const isActive = label.id === activeLabelId;
                  const sampleCount = samplesByLabel.get(label.id) ?? 0;

                  return (
                    <button
                      key={label.id}
                      type="button"
                      onClick={() => setActiveLabelId(label.id)}
                      className={[
                        "w-full rounded-lg border p-3 text-left transition",
                        isActive ? "border-cyan-400/70 bg-cyan-500/10 shadow-lg" : "border-transparent bg-black/20",
                      ].join(" ")}
                    >
                      <div className="flex flex-col gap-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-3">
                            <div
                              className="h-10 w-10 rounded-md border"
                              style={{ backgroundColor: label.color, borderColor: label.color }}
                            />
                            <div>
                              <Input
                                value={label.name}
                                onChange={(event) => handleLabelNameChange(label.id, event.target.value)}
                                className="h-8 bg-transparent text-sm"
                              />
                              <p className="mt-1 text-xs text-muted-foreground">
                                {label.description}
                              </p>
                            </div>
                          </div>
                          <Badge variant="outline" className="text-xs">
                            {sampleCount} sample{sampleCount === 1 ? "" : "s"}
                          </Badge>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                              <span>Coverage</span>
                              <span className="font-semibold text-foreground">
                                {label.coverage.toFixed(1)}%
                              </span>
                            </div>
                            <Slider
                              value={[label.coverage]}
                              min={0}
                              max={100}
                              step={0.5}
                              onValueChange={([value]) => handleCoverageChange(label.id, value)}
                            />
                          </div>
                          <div>
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                              <span>Confidence</span>
                              <span className="font-semibold text-foreground">
                                {label.confidence}%
                              </span>
                            </div>
                            <Slider
                              value={[label.confidence]}
                              min={0}
                              max={100}
                              step={1}
                              onValueChange={([value]) => handleConfidenceChange(label.id, value)}
                            />
                          </div>
                        </div>

                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <label className="flex items-center gap-2">
                            <span>Color</span>
                            <input
                              type="color"
                              value={label.color}
                              onChange={(event) => handleColorChange(label.id, event.target.value)}
                              className="h-6 w-10 cursor-pointer rounded border border-border bg-transparent p-0"
                            />
                          </label>
                          <div className="flex items-center gap-2">
                            <span>Visible</span>
                            <Switch
                              checked={label.visible}
                              onCheckedChange={(checked) => handleVisibilityToggle(label.id, checked)}
                            />
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="glass-card rounded-lg p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-cyan-400" /> Annotation Samples
                </h3>
                <Badge variant="outline" className="text-xs text-muted-foreground">
                  {totalSamples} captured
                </Badge>
              </div>

              {annotations.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Use the drawing tools to capture labeled samples as points, polygons, or rectangles. Activate a label from the library, then click the map to begin outlining.
                </p>
              ) : (
                <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                  {annotations.map((annotation) => {
                    const label = labels.find((item) => item.id === annotation.labelId);
                    const summaryText = (() => {
                      if (annotation.geometryType === "point") {
                        const [lat, lng] = annotation.coordinates[0];
                        return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
                      }

                      const [anchorLat, anchorLng] = annotation.coordinates[0];
                      const shapeLabel =
                        annotation.geometryType === "rectangle" ? "Rectangle" : "Polygon";
                      return `${shapeLabel} (${annotation.coordinates.length} pts) anchor ${anchorLat.toFixed(4)}, ${anchorLng.toFixed(4)}`;
                    })();
                    return (
                      <div
                        key={annotation.id}
                        className="flex items-center justify-between rounded-md bg-black/30 px-3 py-2 text-xs"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span
                              className="inline-block h-3 w-3 rounded-full"
                              style={{ backgroundColor: label?.color ?? "#ffffff" }}
                            />
                            <span className="font-semibold text-foreground">
                              {label?.name ?? "Label"}
                            </span>
                          </div>
                          <div className="mt-1 text-muted-foreground">
                            {summaryText}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveAnnotation(annotation.id)}
                          className="text-muted-foreground hover:text-red-400"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="glass-card rounded-lg p-4">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Layers className="h-4 w-4 text-cyan-400" /> Visualization Layers
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {[
                    { id: "change-mask", label: "Change Mask" },
                    { id: "diff-heatmap", label: "Diff Heatmap" },
                    { id: "before", label: "Before" },
                    { id: "after", label: "After" },
                  ].map((option) => (
                    <Button
                      key={option.id}
                      variant={overlayMode === option.id ? "default" : "outline"}
                      size="sm"
                      onClick={() => setOverlayMode(option.id)}
                      className={overlayMode === option.id ? "bg-cyan-500/90" : "neon-button"}
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <UiLabel className="text-xs">Overlay opacity</UiLabel>
                  <Slider
                    value={[overlayOpacity]}
                    min={0}
                    max={100}
                    step={1}
                    className="w-32"
                    onValueChange={([value]) => setOverlayOpacity(value)}
                  />
                  <span className="w-8 text-right text-foreground">
                    {overlayOpacity}%
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>Show samples</span>
                  <Switch
                    checked={showAnnotations}
                    onCheckedChange={setShowAnnotations}
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <MapPin className="h-4 w-4 text-cyan-400" /> Drawing Mode
                </div>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      { id: "point", label: "Point" },
                      { id: "polygon", label: "Polygon" },
                      { id: "rectangle", label: "Rectangle" },
                    ] as Array<{ id: DrawingMode; label: string }>
                  ).map((mode) => (
                    <Button
                      key={mode.id}
                      variant={drawingMode === mode.id ? "default" : "outline"}
                      size="sm"
                      onClick={() => setDrawingMode(mode.id)}
                      className={drawingMode === mode.id ? "bg-cyan-500/90" : "neon-button"}
                    >
                      {mode.label}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="relative h-[520px] overflow-hidden rounded-lg border border-cyan-500/30 bg-black/40">
                {hasResults ? (
                  <MapContainer
                    center={mapCenter}
                    zoom={13}
                    style={{ height: "100%", width: "100%" }}
                    zoomControl={true}
                  >
                    <FitBounds bounds={mapBounds} />
                    <TileLayer
                      url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                    />

                    {overlayUrl && (
                      <ImageOverlay
                        url={overlayUrl}
                        bounds={mapBounds}
                        opacity={overlayOpacity / 100}
                      />
                    )}

                    {showAnnotations && annotations.map((annotation) => {
                      const label = labels.find((item) => item.id === annotation.labelId);
                      const annotationColor = label?.color ?? "#ffffff";

                      if (annotation.geometryType === "point") {
                        const [lat, lng] = annotation.coordinates[0];
                        return (
                          <CircleMarker
                            key={annotation.id}
                            center={[lat, lng]}
                            radius={6}
                            pathOptions={{
                              color: annotationColor,
                              weight: 1.5,
                              fillColor: annotationColor,
                              fillOpacity: 0.9,
                            }}
                          />
                        );
                      }

                      return (
                        <Polygon
                          key={annotation.id}
                          positions={annotation.coordinates.map(([lat, lng]) => [lat, lng])}
                          pathOptions={{
                            color: annotationColor,
                            weight: 2,
                            fillColor: annotationColor,
                            fillOpacity: 0.2,
                          }}
                        />
                      );
                    })}
                    {drawingMode === "polygon" && pendingPolygon.length > 0 && (
                      <>
                        <Polyline
                          key="pending-polygon"
                          positions={[
                            ...pendingPolygon,
                            ...(cursorPosition ? [cursorPosition] : []),
                          ]}
                          pathOptions={{
                            color: drawingColor,
                            weight: 2,
                            dashArray: "6 4",
                          }}
                        />
                        {pendingPolygon.map((vertex, index) => (
                          <CircleMarker
                            key={`pending-vertex-${index}`}
                            center={vertex}
                            radius={4}
                            pathOptions={{
                              color: drawingColor,
                              weight: 1,
                              fillColor: drawingColor,
                              fillOpacity: 0.8,
                            }}
                          />
                        ))}
                      </>
                    )}

                    {drawingMode === "rectangle" && pendingRectangleStart && (
                      <>
                        <CircleMarker
                          key="pending-rect-start"
                          center={pendingRectangleStart}
                          radius={4}
                          pathOptions={{
                            color: drawingColor,
                            weight: 1,
                            fillColor: drawingColor,
                            fillOpacity: 0.8,
                          }}
                        />
                        {cursorPosition && (
                          <Polygon
                            key="pending-rect"
                            positions={createRectangleFromCorners(
                              pendingRectangleStart,
                              cursorPosition,
                            )}
                            pathOptions={{
                              color: drawingColor,
                              weight: 2,
                              fillColor: drawingColor,
                              fillOpacity: 0.1,
                              dashArray: "6 4",
                            }}
                          />
                        )}
                      </>
                    )}

                    <AnnotationCapture onMapClick={handleMapClick} onCursorMove={handleCursorMove} />
                  </MapContainer>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                    <Layers className="h-12 w-12 text-cyan-400 opacity-60" />
                    <p className="text-sm text-muted-foreground max-w-md">
                      Upload and analyze an image pair to unlock semantic overlays. You can still prepare label classes and capture notes without a backdrop.
                    </p>
                  </div>
                )}

                {drawingLabel && (
                  <div className="absolute left-4 top-4 space-y-2 rounded-md bg-black/80 px-3 py-2 text-xs text-cyan-300 shadow-lg">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block h-3 w-3 rounded-full"
                        style={{ backgroundColor: drawingLabel.color }}
                      />
                      <span>{drawingLabel.name}</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {drawingInstructions}
                    </div>
                    {drawingMode === "polygon" && pendingPolygon.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleCompletePolygon}
                          disabled={!canCompletePolygon}
                          className="border-cyan-500/50 px-2 py-1 text-[11px] text-cyan-200"
                        >
                          Close Polygon
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleUndoLastVertex}
                          className="border-cyan-500/50 px-2 py-1 text-[11px] text-cyan-200"
                        >
                          Undo
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleCancelPendingShape}
                          className="border-red-500/40 px-2 py-1 text-[11px] text-red-200"
                        >
                          Cancel
                        </Button>
                      </div>
                    )}
                    {drawingMode === "rectangle" && pendingRectangleStart && (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleCancelPendingShape}
                          className="border-red-500/40 px-2 py-1 text-[11px] text-red-200"
                        >
                          Cancel
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                {labels.some((label) => label.visible) && (
                  <div className="absolute bottom-4 right-4 rounded-md bg-black/80 px-3 py-2 text-xs text-muted-foreground shadow-lg">
                    <div className="font-semibold text-cyan-300">Legend</div>
                    <div className="mt-2 space-y-1">
                      {labels.filter((label) => label.visible).map((label) => (
                        <div key={label.id} className="flex items-center gap-2">
                          <span
                            className="inline-block h-3 w-3 rounded-full"
                            style={{ backgroundColor: label.color }}
                          />
                          <span>{label.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="glass-card rounded-lg p-4">
              <h3 className="text-sm font-semibold text-foreground mb-3">Label Readiness Checklist</h3>
              <ul className="space-y-2 text-xs text-muted-foreground">
                <li>
                  - Balance label coverage so the stacked bar approximates overall change footprint.
                </li>
                <li>
                  - Capture at least 3 samples per class for a minimal validation set.
                </li>
                <li>
                  - Export GeoJSON samples for training downstream classifiers or sharing with GIS teams.
                </li>
              </ul>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default SemanticLabelingPanel;










