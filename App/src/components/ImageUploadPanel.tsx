import React, { useState, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Alert, AlertDescription } from "./ui/alert";
import { Upload, FileImage, CheckCircle, XCircle, Trash2 } from "lucide-react";

export interface UploadedImageSet {
  beforeVV: File | null;
  beforeVH: File | null;
  afterVV: File | null;
  afterVH: File | null;
}

type UploadKey = keyof UploadedImageSet;
type ValidityState = Record<UploadKey, boolean | null>;

const EMPTY_FILES: UploadedImageSet = {
  beforeVV: null,
  beforeVH: null,
  afterVV: null,
  afterVH: null,
};

const createValidityState = (files: UploadedImageSet): ValidityState => ({
  beforeVV: files.beforeVV ? true : null,
  beforeVH: files.beforeVH ? true : null,
  afterVV: files.afterVV ? true : null,
  afterVH: files.afterVH ? true : null,
});

const normaliseFiles = (files?: UploadedImageSet): UploadedImageSet => ({
  beforeVV: files?.beforeVV ?? null,
  beforeVH: files?.beforeVH ?? null,
  afterVV: files?.afterVV ?? null,
  afterVH: files?.afterVH ?? null,
});

interface ImageUploadPanelProps {
  value?: UploadedImageSet;
  onImagesUploaded?: (files: UploadedImageSet) => void;
  onContinue?: () => void;
}

const ImageUploadPanel: React.FC<ImageUploadPanelProps> = ({
  value,
  onImagesUploaded = () => {},
  onContinue,
}) => {
  const initialFiles = normaliseFiles(value);
  const [files, setFiles] = useState<UploadedImageSet>(initialFiles);
  const [validity, setValidity] = useState<ValidityState>(createValidityState(initialFiles));
  const [uploading, setUploading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (value === undefined) {
      setFiles(EMPTY_FILES);
      setValidity(createValidityState(EMPTY_FILES));
      return;
    }
    const normalised = normaliseFiles(value);
    setFiles(normalised);
    setValidity((prev) => ({
      beforeVV: normalised.beforeVV ? prev.beforeVV ?? true : null,
      beforeVH: normalised.beforeVH ? prev.beforeVH ?? true : null,
      afterVV: normalised.afterVV ? prev.afterVV ?? true : null,
      afterVH: normalised.afterVH ? prev.afterVH ?? true : null,
    }));
  }, [value]);

  const hasRequiredFiles = Boolean(files.beforeVV && files.afterVV);

  const validateGeoTIFF = useCallback(async (file: File): Promise<boolean> => {
    const validExtensions = [".tif", ".tiff", ".geotiff"];
    const fileName = file.name.toLowerCase();
    const hasValidExtension = validExtensions.some((ext) => fileName.endsWith(ext));
    if (!hasValidExtension) {
      setError("Only GeoTIFF files (.tif, .tiff, .geotiff) are supported");
      return false;
    }
    return true;
  }, []);

  const propagateFiles = useCallback(
    (nextFiles: UploadedImageSet, nextValidity: Partial<ValidityState> = {}) => {
      setFiles(nextFiles);
      setValidity((prev) => ({ ...prev, ...nextValidity }));
      onImagesUploaded(nextFiles);
    },
    [onImagesUploaded],
  );

  const handleFileChange = useCallback(
    async (
      e: React.ChangeEvent<HTMLInputElement>,
      type: UploadKey,
    ) => {
      setError(null);
      const file = e.target.files && e.target.files.length > 0 ? e.target.files[0] : null;
      if (!file) {
        return;
      }
      setUploading(true);

      try {
        const isValid = await validateGeoTIFF(file);
        if (!isValid) {
          return;
        }
        const nextFiles = { ...files, [type]: file } as UploadedImageSet;
        propagateFiles(nextFiles, { [type]: true });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error processing file. Please try again.");
      } finally {
        setUploading(false);
      }
    },
    [files, propagateFiles, validateGeoTIFF],
  );

  const handleFileDrop = useCallback(
    async (
      e: React.DragEvent,
      type: UploadKey,
    ) => {
      e.preventDefault();
      e.stopPropagation();
      setError(null);
      const droppedFile = e.dataTransfer.files && e.dataTransfer.files.length > 0 ? e.dataTransfer.files[0] : null;
      if (!droppedFile) return;
      setUploading(true);
      try {
        const isValid = await validateGeoTIFF(droppedFile);
        if (!isValid) {
          return;
        }
        const nextFiles = { ...files, [type]: droppedFile } as UploadedImageSet;
        propagateFiles(nextFiles, { [type]: true });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error processing file. Please try again.");
      } finally {
        setUploading(false);
      }
    },
    [files, propagateFiles, validateGeoTIFF],
  );

  const handleRemoveFile = useCallback(
    (type: UploadKey) => {
      const nextFiles = { ...files, [type]: null } as UploadedImageSet;
      propagateFiles(nextFiles, { [type]: null });
    },
    [files, propagateFiles],
  );

  const renderUploadArea = (
    type: UploadKey,
    displayName: string,
    file: File | null,
    isValid: boolean | null,
    required: boolean,
  ) => (
    <div className="space-y-2">
      <div
        className={`border-2 border-dashed ${required ? "border-cyan-500/50" : "border-cyan-500/30"} rounded-lg p-4 text-center hover:border-cyan-500/70 transition-colors cursor-pointer hologram-card`}
        onDrop={(event) => handleFileDrop(event, type)}
        onDragOver={(event) => event.preventDefault()}
        onDragEnter={(event) => event.preventDefault()}
        onClick={() => document.getElementById(`${type}-file-input`)?.click()}
      >
        <input
          id={`${type}-file-input`}
          type="file"
          accept=".tif,.tiff,.geotiff"
          onChange={(event) => handleFileChange(event, type)}
          className="hidden"
        />

        {!file ? (
          <div className="space-y-2">
            <Upload className="mx-auto h-8 w-8 text-cyan-400" />
            <div>
              <p className="text-md font-medium text-foreground">
                {displayName} {required && <span className="text-red-400">*</span>}
              </p>
              <p className="text-xs text-muted-foreground">
                {required ? "Required" : "Optional"} GeoTIFF
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-center gap-2">
              <FileImage className="h-6 w-6 text-cyan-400" />
              {isValid ? (
                <CheckCircle className="h-5 w-5 text-green-500" />
              ) : (
                <XCircle className="h-5 w-5 text-red-500" />
              )}
            </div>
            <div>
              <p className="font-medium text-foreground text-sm">{file.name}</p>
              <p className="text-xs text-muted-foreground">
                {(file.size / 1024 / 1024).toFixed(2)} MB
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={(event) => {
                event.stopPropagation();
                handleRemoveFile(type);
              }}
              className="neon-button text-xs py-1"
            >
              <Trash2 className="h-3 w-3 mr-1" />
              Remove
            </Button>
          </div>
        )}
      </div>
    </div>
  );

  const handleContinue = () => {
    if (!hasRequiredFiles || uploading) return;
    onImagesUploaded(files);
    onContinue?.();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-cyan-400 glow-text">SAR Image Upload</h2>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
          <span className="text-sm text-green-400">SYSTEM READY</span>
        </div>
      </div>

      <Alert className="border-cyan-500/50 bg-cyan-500/10">
        <AlertDescription className="text-cyan-400">
          Upload terrain-corrected (TC) VV/VH SAR GeoTIFF files. VV bands are required, VH bands are optional.
        </AlertDescription>
      </Alert>

      {error && (
        <Alert className="border-red-500/50 bg-red-500/10">
          <XCircle className="h-4 w-4" />
          <AlertDescription className="text-red-400">{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <Card className="hologram-card">
          <CardHeader>
            <CardTitle className="text-cyan-400">Before SAR Images</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {renderUploadArea("beforeVV", "Before VV", files.beforeVV, validity.beforeVV, true)}
            {renderUploadArea("beforeVH", "Before VH", files.beforeVH, validity.beforeVH, false)}
          </CardContent>
        </Card>

        <Card className="hologram-card">
          <CardHeader>
            <CardTitle className="text-cyan-400">After SAR Images</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {renderUploadArea("afterVV", "After VV", files.afterVV, validity.afterVV, true)}
            {renderUploadArea("afterVH", "After VH", files.afterVH, validity.afterVH, false)}
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-center">
        <Button
          onClick={handleContinue}
          disabled={!hasRequiredFiles || uploading}
          size="lg"
          className="neon-button px-8"
        >
          {uploading ? "Processing..." : "Continue to Analysis"}
        </Button>
      </div>
    </div>
  );
};

export default ImageUploadPanel;
