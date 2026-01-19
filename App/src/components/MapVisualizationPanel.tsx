import React, { useState, useEffect, useMemo } from "react";
import { MapContainer, TileLayer, ImageOverlay, GeoJSON, useMap } from "react-leaflet";
import { LatLngBounds } from "leaflet";
import "leaflet/dist/leaflet.css";
import type { ObjectDetectionResult } from "@/lib/objectDetection";
import { Card, CardContent } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Map as MapIcon, Layers } from "lucide-react";

interface MapVisualizationPanelProps {
  beforeImage?: File | null;
  afterImage?: File | null;
  analysisResults?: any;
  detectionResults?: ObjectDetectionResult | null;
  selectedAOI?: [number, number, number, number] | null;
}

function MapController({ bounds }: { bounds: LatLngBounds }) {
  const map = useMap();
  useEffect(() => {
    if (bounds) {
      map.fitBounds(bounds);
    }
  }, [bounds, map]);
  return null;
}

const MapVisualizationPanel = ({
  beforeImage = null,
  afterImage = null,
  analysisResults = null,
  detectionResults = null,
  selectedAOI = null,
}: MapVisualizationPanelProps) => {
  const [mapMode, setMapMode] = useState<string>("overlay");
  const [opacity, setOpacity] = useState<number>(70);
  const [showMask, setShowMask] = useState<boolean>(true);
  const [maskOpacity, setMaskOpacity] = useState<number>(60);
  const [basemap, setBasemap] = useState<string>("dark");
  const [showDetections, setShowDetections] = useState<boolean>(true);
  const [detectionOpacity, setDetectionOpacity] = useState<number>(80);

  const hasResults = Boolean(analysisResults);
  const hasDetections = Boolean(detectionResults && detectionResults.boxes && detectionResults.boxes.length > 0);

  const derivedBoundsArray = useMemo<[number, number, number, number] | null>(() => {
    if (analysisResults?.bounds && analysisResults.bounds.length === 4) {
      return analysisResults.bounds as [number, number, number, number];
    }
    if (selectedAOI && selectedAOI.length === 4) {
      return selectedAOI as [number, number, number, number];
    }
    if (
      analysisResults?.coordinates?.lat !== undefined &&
      analysisResults?.coordinates?.lng !== undefined
    ) {
      const { lat, lng } = analysisResults.coordinates;
      return [lng - 0.02, lat - 0.02, lng + 0.02, lat + 0.02];
    }
    return null;
  }, [
    analysisResults?.bounds,
    analysisResults?.coordinates?.lat,
    analysisResults?.coordinates?.lng,
    selectedAOI,
  ]);

  const bounds = useMemo(() => {
    if (derivedBoundsArray) {
      const [west, south, east, north] = derivedBoundsArray;
      return new LatLngBounds([south, west], [north, east]);
    }
    return new LatLngBounds([40.7, -74.01], [40.72, -73.99]);
  }, [derivedBoundsArray]);

  const center: [number, number] =
    analysisResults?.coordinates?.lat !== undefined &&
    analysisResults?.coordinates?.lng !== undefined
      ? [analysisResults.coordinates.lat, analysisResults.coordinates.lng]
      : derivedBoundsArray
        ? [
            (derivedBoundsArray[1] + derivedBoundsArray[3]) / 2,
            (derivedBoundsArray[0] + derivedBoundsArray[2]) / 2,
          ]
        : [40.7128, -74.006];

  const beforeOverlayUrl =
    analysisResults?.mapOverlays?.before ||
    analysisResults?.beforePreviewUrl ||
    null;

  const afterOverlayUrl =
    analysisResults?.mapOverlays?.after ||
    analysisResults?.afterPreviewUrl ||
    null;

  const maskOverlayUrl =
    analysisResults?.mapOverlays?.changeMask ||
    analysisResults?.maskPreview ||
    null;

  const overlayUrl =
    analysisResults?.mapOverlays?.overlay ||
    maskOverlayUrl;

  const detectionOverlayUrl = detectionResults?.overlayUrl ?? null;
  const detectionFeatures = detectionResults?.featureCollection ?? null;
  const detectionBoundsArray = detectionResults?.bounds && detectionResults.bounds.length === 4
    ? (detectionResults.bounds as [number, number, number, number])
    : derivedBoundsArray;

  const centerLat = center[0];
  const centerLng = center[1];

  const detectionBounds = useMemo(() => {
    if (detectionBoundsArray) {
      const [west, south, east, north] = detectionBoundsArray;
      return new LatLngBounds([south, west], [north, east]);
    }
    return bounds;
  }, [detectionBoundsArray, bounds]);

  // Basemap URLs
  const basemapUrls: Record<string, string> = {
    dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    light: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    osm: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    satellite: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-cyan-400 glow-text flex items-center gap-2">
          <MapIcon className="h-6 w-6" />
          Interactive SAR Map Visualization
        </h2>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse"></span>
          <span className="text-sm text-cyan-400">LIVE MAP</span>
        </div>
      </div>

      {/* File Information */}
      {hasResults && (
        <div className="grid grid-cols-2 gap-4">
          <div className="hologram-card p-3 rounded-lg">
            <h3 className="text-sm font-medium text-cyan-400">Before SAR Image</h3>
            <p className="text-xs text-muted-foreground truncate">
              {analysisResults?.beforeFileName ?? "N/A"}
            </p>
          </div>
          <div className="hologram-card p-3 rounded-lg">
            <h3 className="text-sm font-medium text-cyan-400">After SAR Image</h3>
            <p className="text-xs text-muted-foreground truncate">
              {analysisResults?.afterFileName ?? "N/A"}
            </p>
          </div>
        </div>
      )}

      {/* Map Controls */}
      <Card className="hologram-card">
        <CardContent className="p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <Label className="text-sm font-medium text-foreground mb-2 block">
                Basemap
              </Label>
              <Select value={basemap} onValueChange={setBasemap}>
                <SelectTrigger className="glass-card">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="glass-card">
                  <SelectItem value="dark">Dark</SelectItem>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="osm">OpenStreetMap</SelectItem>
                  <SelectItem value="satellite">Satellite</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-sm font-medium text-foreground mb-2 block">
                View Mode
              </Label>
              <Select value={mapMode} onValueChange={setMapMode}>
                <SelectTrigger className="glass-card">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="glass-card">
                  <SelectItem value="before">Before Only</SelectItem>
                  <SelectItem value="after">After Only</SelectItem>
                  <SelectItem value="overlay">Overlay</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-sm font-medium text-foreground mb-2 block">
                Image Opacity: {opacity}%
              </Label>
              <Slider
                value={[opacity]}
                onValueChange={(v) => setOpacity(v[0])}
                min={0}
                max={100}
                step={5}
                className="accent-cyan-500"
              />
            </div>

            <div>
              <Label className="text-sm font-medium text-foreground mb-2 block">
                Mask Opacity: {maskOpacity}%
              </Label>
              <Slider
                value={[maskOpacity]}
                onValueChange={(v) => setMaskOpacity(v[0])}
                min={0}
                max={100}
                step={5}
                className="accent-cyan-500"
                disabled={!showMask}
              />
            </div>
            <div>
              <Label className="text-sm font-medium text-foreground mb-2 block">
                Detection Opacity: {detectionOpacity}%
              </Label>
              <Slider
                value={[detectionOpacity]}
                onValueChange={(v) => setDetectionOpacity(v[0])}
                min={0}
                max={100}
                step={5}
                className="accent-cyan-500"
                disabled={!hasDetections || !showDetections}
              />
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <Switch
                checked={showMask}
                onCheckedChange={setShowMask}
                className="data-[state=checked]:bg-cyan-500"
              />
              <span className="text-sm font-medium text-foreground">Show Change Mask</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <Switch
                checked={showDetections && hasDetections}
                onCheckedChange={(checked) => setShowDetections(checked)}
                disabled={!hasDetections}
                className="data-[state=checked]:bg-lime-500"
              />
              <span className="text-sm font-medium text-foreground">Show Detections</span>
            </label>
          </div>
        </CardContent>
      </Card>

      {/* Map Display */}
      <Card className="hologram-card">
        <CardContent className="p-0">
          <div className="relative rounded-lg overflow-hidden glow-border" style={{ height: "600px" }}>
            {hasResults ? (
              <MapContainer
                center={center}
                zoom={13}
                style={{ height: "100%", width: "100%", background: "#0a1016" }}
                zoomControl={true}
              >
                <MapController bounds={bounds} />
                
                {/* Basemap */}
                <TileLayer
                  url={basemapUrls[basemap]}
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                />

                {/* Before Image */}
                {(mapMode === "before" || mapMode === "overlay") && beforeOverlayUrl && (
                  <ImageOverlay
                    url={beforeOverlayUrl}
                    bounds={bounds}
                    opacity={mapMode === "overlay" ? opacity / 100 : 1}
                  />
                )}

                {/* After Image */}
                {(mapMode === "after" || mapMode === "overlay") && afterOverlayUrl && (
                  <ImageOverlay
                    url={afterOverlayUrl}
                    bounds={bounds}
                    opacity={mapMode === "overlay" ? (100 - opacity) / 100 : 1}
                  />
                )}

                {/* Change Mask Overlay */}
                {showMask && overlayUrl && (
                  <ImageOverlay
                    url={overlayUrl}
                    bounds={bounds}
                    opacity={maskOpacity / 100}
                  />
                )}

                {/* Detection Overlay */}
                {showDetections && hasDetections && detectionOverlayUrl && (
                  <ImageOverlay
                    url={detectionOverlayUrl}
                    bounds={detectionBounds}
                    opacity={detectionOpacity / 100}
                  />
                )}

                {showDetections && hasDetections && detectionFeatures && detectionFeatures.features.length > 0 && (
                  <GeoJSON
                    data={detectionFeatures as any}
                    style={() => ({ color: '#00E5FF', weight: 1.2, fillOpacity: 0 })}
                  />
                )}
              </MapContainer>
            ) : (
              <div className="flex items-center justify-center h-full bg-muted/10">
                <div className="text-center p-8">
                  <Layers className="h-16 w-16 text-cyan-400 mx-auto mb-4 opacity-50" />
                  <h3 className="text-lg font-medium text-foreground mb-2">
                    No Analysis Results
                  </h3>
                  <p className="text-sm text-muted-foreground max-w-md">
                    Run the analysis first to visualize SAR imagery and change detection results on the map.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Map Info Overlay */}
          {hasResults && (
            <div className="absolute bottom-4 left-4 bg-black/80 text-cyan-400 px-3 py-2 rounded font-mono text-xs z-[1000]">
              <div>Center: {centerLat.toFixed(4)} deg, {centerLng.toFixed(4)} deg</div>
              <div>Size: {(analysisResults?.width ?? "N/A")} x {(analysisResults?.height ?? "N/A")} px</div>
              <div>Coverage: {(analysisResults?.changePercentage ?? "N/A")} %</div>
              <div>Area: {analysisResults?.changeAreaKm2 !== undefined && analysisResults?.changeAreaKm2 !== null ? `${analysisResults.changeAreaKm2.toFixed(3)} km^2` : "N/A"}</div>
              {hasDetections && (
                <div>Detections: {detectionResults?.boxes.length ?? 0}</div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Statistics */}
      {hasResults && (
        <div className="grid grid-cols-4 gap-4">
          <div className="hologram-card p-4 rounded-lg text-center">
            <div className="text-lg font-bold text-cyan-400 glow-text">
              {(analysisResults?.changedPixels ? analysisResults.changedPixels.toLocaleString() : "N/A")}
            </div>
            <div className="text-xs text-muted-foreground">CHANGED PIXELS</div>
          </div>
          <div className="hologram-card p-4 rounded-lg text-center">
            <div className="text-lg font-bold text-cyan-400 glow-text">
              {(analysisResults?.changePercentage ?? "N/A")} %
            </div>
            <div className="text-xs text-muted-foreground">COVERAGE</div>
          </div>
          <div className="hologram-card p-4 rounded-lg text-center">
            <div className="text-lg font-bold text-green-400 glow-text">
              {analysisResults?.algorithm ? analysisResults.algorithm.toUpperCase() : "N/A"}
            </div>
            <div className="text-xs text-muted-foreground">ALGORITHM</div>
          </div>
          <div className="hologram-card p-4 rounded-lg text-center">
            <div className="text-lg font-bold text-cyan-400 glow-text">
              {hasDetections && detectionResults ? detectionResults.boxes.length : 0}
            </div>
            <div className="text-xs text-muted-foreground">DETECTIONS</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MapVisualizationPanel;
