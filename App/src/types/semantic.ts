export type AnnotationGeometryType = "point" | "polygon" | "rectangle";

export interface SemanticLabel {
  id: string;
  name: string;
  color: string;
  coverage: number;
  confidence: number;
  description: string;
  visible: boolean;
}

export interface LabelAnnotation {
  id: string;
  labelId: string;
  geometryType: AnnotationGeometryType;
  coordinates: Array<[number, number]>;
  createdAt: string;
}

export interface LabelingSummary {
  labels: SemanticLabel[];
  annotations: LabelAnnotation[];
  updatedAt: string;
}

export interface LabelExportPayload extends LabelingSummary {
  format: "geojson";
  geojson: {
    type: "FeatureCollection";
    features: Array<{
      type: "Feature";
      geometry:
        | {
            type: "Point";
            coordinates: [number, number];
          }
        | {
            type: "Polygon";
            coordinates: Array<Array<[number, number]>>;
          };
      properties: {
        labelId: string;
        labelName: string;
        color: string;
        createdAt: string;
        geometryType: AnnotationGeometryType;
        vertexCount: number;
      };
    }>;
  };
}
