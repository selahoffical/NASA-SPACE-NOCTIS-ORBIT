import React, { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import ImageUploadPanel, { UploadedImageSet } from "./ImageUploadPanel";
import { LabelExportPayload, LabelingSummary } from "@/types/semantic";
import { persistLabelingSnapshot, persistLabelExport } from "@/lib/labelingAnalytics";
import AnalysisPanel from "./AnalysisPanel";
import MapVisualizationPanel from "./MapVisualizationPanel";
import ExportPanel from "./ExportPanel";
import ObjectDetectionPanel from "./ObjectDetectionPanel";
import SemanticLabelingPanel from "./SemanticLabelingPanel";
import type { ObjectDetectionResult } from "@/lib/objectDetection";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/contexts/ThemeContext";
import { Moon, Sun, Satellite } from "lucide-react";

export default function Home() {
  const { theme, setTheme } = useTheme();
  const [activeTab, setActiveTab] = useState("upload");
  const [uploadedImages, setUploadedImages] = useState<UploadedImageSet>({
    beforeVV: null,
    beforeVH: null,
    afterVV: null,
    afterVH: null,
  });
  const [analysisResults, setAnalysisResults] = useState<any>(null);
  const [selectedAOI, setSelectedAOI] = useState<[number, number, number, number] | null>(null);
  const [detectionResults, setDetectionResults] = useState<ObjectDetectionResult | null>(null);
  const [labelingSummary, setLabelingSummary] = useState<LabelingSummary | null>(null);
  const [labelExportPayload, setLabelExportPayload] = useState<LabelExportPayload | null>(null);

  const handleImagesUploaded = (files: UploadedImageSet) => {
    setUploadedImages(files);
    setDetectionResults(null);
    setLabelingSummary(null);
    setLabelExportPayload(null);
  };

  const handleAnalysisComplete = (results: any) => {
    setAnalysisResults(results);

    if (Array.isArray(results?.bounds) && results.bounds.length === 4) {
      setSelectedAOI(results.bounds as [number, number, number, number]);
    }

    // Stay on the analysis tab so results remain visible.
  };

  const handleAOISelected = (aoi: [number, number, number, number]) => {
    setSelectedAOI(aoi);
  };

  const handleDetectionComplete = (result: ObjectDetectionResult | null) => {
    setDetectionResults(result);
  };
  const handleLabelingComplete = (summary: LabelingSummary) => {
    setLabelingSummary(summary);
    persistLabelingSnapshot(summary);
  };

  const handleLabelExport = (payload: LabelExportPayload) => {
    setLabelExportPayload(payload);
    persistLabelExport(payload);
  };

  // Check if required images are uploaded for enabling tabs
  const hasRequiredImages = uploadedImages.beforeVV && uploadedImages.afterVV;

  return (
    <div className="min-h-screen bg-background cyber-grid p-6">
      <header className="mb-8">
        <div className="flex items-center gap-4 mb-4">
          <div className="w-12 h-12 bg-gradient-to-br from-cyan-400 to-blue-500 rounded-lg flex items-center justify-center">
            <span className="text-black font-bold text-xl">NO</span>
          </div>
          <div>
            <h1 className="text-4xl font-bold text-foreground glow-text font-orbitron">
              NOCTIS ORBIT
            </h1>
            <p className="text-cyan-400 text-sm font-medium tracking-wider">
              ADVANCED SATELLITE INTELLIGENCE
            </p>
          </div>
        </div>
        <h2 className="text-2xl font-semibold text-foreground mb-2">
          SARSentinel: SAR Change Detection & Visualization Tool
        </h2>
        <p className="text-muted-foreground">
          Analyze and visualize changes between SAR imagery pairs with
          interactive map visualization, automated change detection, and
          semantic labeling capabilities.
        </p>
        <Separator className="my-6 bg-gradient-to-r from-transparent via-cyan-500 to-transparent h-px" />
      </header>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid grid-cols-6 w-full max-w-6xl mb-8 bg-card/50 backdrop-blur-sm border border-cyan-500/20">
          <TabsTrigger
            value="upload"
            className="neon-button data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-400"
          >
            Image Upload
          </TabsTrigger>
          <TabsTrigger
            value="analysis"
            disabled={!hasRequiredImages}
            className="neon-button data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-400"
          >
            Analysis
          </TabsTrigger>
          <TabsTrigger
            value="visualization"
            disabled={!analysisResults}
            className="neon-button data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-400"
          >
            Map Visualization
          </TabsTrigger>
          <TabsTrigger
            value="labeling"
            disabled={!analysisResults}
            className="neon-button data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-400"
          >
            Semantic Labeling
          </TabsTrigger>
          <TabsTrigger
            value="detection"
            disabled={!uploadedImages.afterVV}
            className="neon-button data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-400"
          >
            Object Detection
          </TabsTrigger>
          <TabsTrigger
            value="export"
            disabled={!analysisResults}
            className="neon-button data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-400"
          >
            Export
          </TabsTrigger>
        </TabsList>

        <TabsContent value="upload" className="hologram-card p-6 rounded-lg">
          <ImageUploadPanel

            value={uploadedImages}

            onImagesUploaded={handleImagesUploaded}

            onContinue={() => setActiveTab("analysis")}

          />
        </TabsContent>

        <TabsContent value="analysis" className="hologram-card p-6 rounded-lg">
          <AnalysisPanel
            beforeImage={uploadedImages.beforeVV}
            afterImage={uploadedImages.afterVV}
            onAnalysisComplete={handleAnalysisComplete}
            onAOISelected={handleAOISelected}
          />
        </TabsContent>

        <TabsContent
          value="visualization"
          className="hologram-card p-6 rounded-lg"
        >
          <MapVisualizationPanel
            beforeImage={uploadedImages.beforeVV}
            afterImage={uploadedImages.afterVV}
            analysisResults={analysisResults}
            detectionResults={detectionResults}
          />
        </TabsContent>

        <TabsContent value="labeling" className="hologram-card p-6 rounded-lg">
          <SemanticLabelingPanel
            areaOfInterest={selectedAOI ?? undefined}
            analysisResults={analysisResults}
            onLabelingComplete={handleLabelingComplete}
            onExportLabels={handleLabelExport}
          />
        </TabsContent>

        <TabsContent value="detection" className="hologram-card p-6 rounded-lg">
          <ObjectDetectionPanel
            afterImage={uploadedImages.afterVV}
            onDetectionComplete={handleDetectionComplete}
            semanticSummary={labelingSummary}
            semanticExport={labelExportPayload}
          />
        </TabsContent>

        <TabsContent value="export" className="hologram-card p-6 rounded-lg">
          <ExportPanel
            analysisResults={analysisResults}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}






