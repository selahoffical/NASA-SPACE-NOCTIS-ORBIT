import React, { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Download, FileJson, FileType2, FileCode, Check } from "lucide-react";

interface ExportPanelProps {
  analysisResults?: {
    changeDetection: any;
    semanticLabels: any;
    objectDetection?: any;
  };
  onExport?: (format: string, options: any) => Promise<void>;
}

const ExportPanel = ({
  analysisResults = null,
  onExport = async () => {},
}: ExportPanelProps) => {
  const [exportFormat, setExportFormat] = useState<string>("geojson");
  const [exportOptions, setExportOptions] = useState({
    includeChangeDetection: true,
    includeSemanticLabels: true,
    includeObjectDetection: false,
    includeMetadata: true,
    resolution: "full",
    filename: "sar_change_detection_results",
  });
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportProgress, setExportProgress] = useState<number>(0);
  const [exportSuccess, setExportSuccess] = useState<boolean>(false);

  const handleExport = async () => {
    if (!analysisResults) return;

    setIsExporting(true);
    setExportProgress(0);
    setExportSuccess(false);

    const interval = setInterval(() => {
      setExportProgress((prev) => Math.min(95, prev + 8));
    }, 180);

    try {
      // Build payload locally. Also call external onExport if provided for side-effects.
      const buildGeoJSON = () => {
        const collection: any = {
          type: "FeatureCollection",
          features: [],
        };
        // Optionally include change detection polygons
        if (exportOptions.includeChangeDetection && analysisResults.changeDetection?.features) {
          collection.features = collection.features.concat(analysisResults.changeDetection.features);
        }

        // Include semantic labels as properties if requested
        if (exportOptions.includeSemanticLabels && analysisResults.semanticLabels?.features) {
          collection.features = collection.features.concat(analysisResults.semanticLabels.features);
        }

        // Include object detection results
        if (exportOptions.includeObjectDetection && analysisResults.objectDetection) {
          const od = analysisResults.objectDetection;
          if (od.featureCollection && od.featureCollection.features) {
            collection.features = collection.features.concat(od.featureCollection.features);
          } else if (od.boxes && Array.isArray(od.boxes)) {
            // convert bbox to GeoJSON polygon in pixel coords (no geotransform available)
            const boxes = od.boxes as any[];
            for (const b of boxes) {
              const x = b.bbox.x;
              const y = b.bbox.y;
              const w = b.bbox.width;
              const h = b.bbox.height;
              const poly = {
                type: "Feature",
                properties: {
                  id: b.id,
                  label: b.label,
                  confidence: b.confidence,
                  area_pixels: b.areaPixels,
                  source: b.source ?? "heuristic",
                },
                geometry: {
                  type: "Polygon",
                  coordinates: [[
                    [x, y],
                    [x + w, y],
                    [x + w, y + h],
                    [x, y + h],
                    [x, y]
                  ]],
                },
              };
              collection.features.push(poly);
            }
          }
        }

        collection.properties = {
          generatedAt: new Date().toISOString(),
          resolution: exportOptions.resolution,
        };
        return collection;
      };

      const buildCSV = () => {
        // prioritize objectDetection boxes
        const rows: string[] = [];
        const header = [
          "id",
          "label",
          "category",
          "confidence",
          "x",
          "y",
          "width",
          "height",
          "area_pixels",
          "source",
        ];
        rows.push(header.join(","));
        const od = analysisResults.objectDetection;
        if (od && od.boxes && Array.isArray(od.boxes)) {
          for (const b of od.boxes) {
            const cols = [
              `"${String(b.id)}"`,
              `"${String(b.label)}"`,
              `"${String(b.categoryId)}"`,
              (b.confidence ?? 0).toFixed(4),
              Math.round(b.bbox.x),
              Math.round(b.bbox.y),
              Math.round(b.bbox.width),
              Math.round(b.bbox.height),
              b.areaPixels ?? "",
              `"${b.source ?? "heuristic"}"`,
            ];
            rows.push(cols.join(","));
          }
        }
        return rows.join("\r\n");
      };

      const buildHTML = (geojson: any) => {
        const html = `<!doctype html><html><head><meta charset="utf-8"><title>Export Preview</title></head><body><h2>Export Preview</h2><pre>${escapeHtml(JSON.stringify(geojson, null, 2))}</pre></body></html>`;
        return html;
      };

      const escapeHtml = (str: string) =>
        str.replace(/[&<>"']/g, (c) => ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        }[c] ?? c));

      let blob: Blob;
      let filename = exportOptions.filename || "sar_export";

      if (exportFormat === "geojson") {
        const geo = buildGeoJSON();
        blob = new Blob([JSON.stringify(geo, null, 2)], { type: "application/geo+json" });
        filename += ".geojson";
      } else if (exportFormat === "csv") {
        const csv = buildCSV();
        blob = new Blob([csv], { type: "text/csv" });
        filename += ".csv";
      } else if (exportFormat === "html") {
        const geo = buildGeoJSON();
        const html = buildHTML(geo);
        blob = new Blob([html], { type: "text/html" });
        filename += ".html";
      } else {
        // fallback to JSON
        const geo = buildGeoJSON();
        blob = new Blob([JSON.stringify(geo, null, 2)], { type: "application/json" });
        filename += ".json";
      }

      // let parent handle side-effects if provided
      try {
        await onExport(exportFormat, exportOptions);
      } catch (err) {
        // ignore; we still continue with client-side download
        console.warn("onExport hook failed", err);
      }

      // trigger download
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setExportProgress(100);
      setExportSuccess(true);
    } catch (error) {
      console.error("Export failed:", error);
      setExportSuccess(false);
    } finally {
      setIsExporting(false);
      clearInterval(interval);
    }
  };

  const handleOptionChange = (key: string, value: any) => {
    setExportOptions((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const getFormatIcon = () => {
    switch (exportFormat) {
      case "geojson":
        return <FileJson className="h-5 w-5 mr-2" />;
      case "geotiff":
        return <FileType2 className="h-5 w-5 mr-2" />;
      case "html":
        return <FileCode className="h-5 w-5 mr-2" />;
      default:
        return <Download className="h-5 w-5 mr-2" />;
    }
  };

  return (
    <Card className="w-full bg-background h-[747px]">
      <CardHeader>
        <CardTitle className="text-2xl">Export Results</CardTitle>
        <CardDescription>
          Export your analysis results in various formats for sharing or further
          processing
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="export-format">Export Format</Label>
              <Select
                value={exportFormat}
                onValueChange={(value) => setExportFormat(value)}
                disabled={isExporting}
              >
                <SelectTrigger id="export-format" className="w-full">
                  <SelectValue placeholder="Select format" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="geojson">GeoJSON</SelectItem>
                  <SelectItem value="geotiff">GeoTIFF</SelectItem>
                  <SelectItem value="html">HTML Viewer</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-4">
              <Label>Export Options</Label>
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="include-change-detection"
                    checked={exportOptions.includeChangeDetection}
                    onCheckedChange={(checked) =>
                      handleOptionChange("includeChangeDetection", checked)
                    }
                    disabled={isExporting}
                  />
                  <Label htmlFor="include-change-detection">
                    Include Change Detection Results
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="include-semantic-labels"
                    checked={exportOptions.includeSemanticLabels}
                    onCheckedChange={(checked) =>
                      handleOptionChange("includeSemanticLabels", checked)
                    }
                    disabled={isExporting}
                  />
                  <Label htmlFor="include-semantic-labels">
                    Include Semantic Labels
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="include-object-detection"
                    checked={exportOptions.includeObjectDetection}
                    onCheckedChange={(checked) =>
                      handleOptionChange("includeObjectDetection", checked)
                    }
                    disabled={isExporting || !analysisResults?.objectDetection}
                  />
                  <Label htmlFor="include-object-detection">
                    Include Object Detection Results
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="include-metadata"
                    checked={exportOptions.includeMetadata}
                    onCheckedChange={(checked) =>
                      handleOptionChange("includeMetadata", checked)
                    }
                    disabled={isExporting}
                  />
                  <Label htmlFor="include-metadata">Include Metadata</Label>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="resolution">Resolution</Label>
              <Select
                value={exportOptions.resolution}
                onValueChange={(value) =>
                  handleOptionChange("resolution", value)
                }
                disabled={isExporting || exportFormat === "html"}
              >
                <SelectTrigger id="resolution" className="w-full">
                  <SelectValue placeholder="Select resolution" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="preview">Preview Resolution</SelectItem>
                  <SelectItem value="full">Full Resolution</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="filename">Filename</Label>
              <Input
                id="filename"
                value={exportOptions.filename}
                onChange={(e) => handleOptionChange("filename", e.target.value)}
                disabled={isExporting}
                placeholder="Enter filename without extension"
              />
            </div>
          </div>

          <div className="space-y-6">
            <div className="border rounded-lg p-4">
              <h3 className="text-lg font-medium mb-2">Export Preview</h3>
              <Tabs defaultValue="details">
                <TabsList className="w-full">
                  <TabsTrigger value="details" className="flex-1">
                    Details
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="details" className="mt-4">
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span>Format:</span>
                      <span className="font-medium">
                        {exportFormat === "geojson" && "GeoJSON (.geojson)"}
                        {exportFormat === "geotiff" && "GeoTIFF (.tif)"}
                        {exportFormat === "html" && "HTML Viewer (.html)"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>File Size (est.):</span>
                      <span className="font-medium">
                        {exportFormat === "geojson" && "~2.5 MB"}
                        {exportFormat === "geotiff" && "~15 MB"}
                        {exportFormat === "html" && "~8 MB"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Contents:</span>
                      <span className="font-medium">
                        {exportOptions.includeChangeDetection
                          ? "Change Detection, "
                          : ""}
                        {exportOptions.includeSemanticLabels
                          ? "Semantic Labels, "
                          : ""}
                        {exportOptions.includeObjectDetection
                          ? "Object Detection, "
                          : ""}
                        {exportOptions.includeMetadata ? "Metadata" : ""}
                      </span>
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </div>

            {isExporting && (
              <div className="space-y-2">
                <Label>Export Progress</Label>
                <Progress value={exportProgress} className="h-2" />
                <p className="text-sm text-muted-foreground">
                  {exportProgress < 100 ? "Exporting..." : "Export complete!"}
                </p>
              </div>
            )}

            {exportSuccess && (
              <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-md p-3 flex items-center">
                <Check className="h-5 w-5 text-green-600 dark:text-green-400 mr-2" />
                <span className="text-green-800 dark:text-green-400 text-sm">
                  Export completed successfully!
                </span>
              </div>
            )}
          </div>
        </div>
      </CardContent>
      <CardFooter className="flex justify-end space-x-2">
        <Button
          variant="outline"
          disabled={isExporting}
          onClick={() =>
            setExportOptions({
              includeChangeDetection: true,
              includeSemanticLabels: true,
              includeObjectDetection: false,
              includeMetadata: true,
              resolution: "full",
              filename: "sar_change_detection_results",
            })
          }
        >
          Reset
        </Button>
        <Button
          onClick={handleExport}
          disabled={isExporting || !analysisResults}
          className="flex items-center"
        >
          {getFormatIcon()}
          {isExporting
            ? "Exporting..."
            : `Export as ${exportFormat.toUpperCase()}`}
        </Button>
      </CardFooter>
    </Card>
  );
};

export default ExportPanel;
