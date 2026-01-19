# 🛰️ NOCTIS-ORBIT

**Through the Radar Looking Glass**  
*Browser-based SAR change detection & object recognition*

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![SAR](https://img.shields.io/badge/SAR-Sentinel--1-green.svg)](https://sentinel.esa.int/web/sentinel/missions/sentinel-1)
[![Client-Side](https://img.shields.io/badge/runs-client--side-orange.svg)]()

---

## 🎯 Overview

A **powerful web application** that brings **Synthetic Aperture Radar (SAR)** analysis to your browser. Upload **Sentinel-1** satellite imagery and detect changes in terrain, infrastructure, and water bodies—**no servers, no GPUs, no installation required**.

Perfect for environmental monitoring, disaster response, infrastructure analysis, and research—all running privately in your browser.

---

## ✨ Features

### 🌐 100% Client-Side Processing
- Everything runs in your browser—**private, fast, and offline-capable**
- Zero backend infrastructure needed
- Your data never leaves your machine
- No API keys or cloud costs

### 🤖 Hybrid Intelligence Pipeline
- **Classical algorithms**: Otsu thresholding + morphological filtering
- **AI-powered detection**: Roboflow object detection (TensorFlow.js / ONNX)
- Combined approach ensures accuracy and reliability

### 🗺️ Interactive Mapping
- Real-time **Leaflet** map visualization
- Draw, annotate, and measure directly on the map
- Polygon vectorization with area calculations
- Seamless pan/zoom across your analysis
- Layer control and overlay management

### 📊 Rich Object Detection
Automatically identifies:
- 🏞️ **Rivers & water bodies**
- 🌲 **Forest cover**
- 🏗️ **Buildings & structures**
- 🛣️ **Roads & infrastructure**
- 🌉 **Bridges**
- 🔀 **Composite layers** (buildings-roads-water)

### 💾 Professional Export Formats
- **GeoTIFF** — Full geospatial rasters with CRS
- **GeoJSON** — Vector geometries for GIS
- **PNG** — High-resolution images
- **CSV** — Tabular metrics & statistics

---

## 🚀 Quick Start

### Prerequisites
- Modern web browser (Chrome, Firefox, Edge recommended)
- Sentinel-1 GeoTIFF data (pre-processed in ESA SNAP)

### Usage
1. **Pre-process** your Sentinel-1 data in ESA SNAP
2. **Open** the NOCTIS-ORBIT web app
3. **Upload** your GeoTIFF file
4. **Analyze** using the hybrid detection pipeline
5. **Interact** with results on the map
6. **Export** in your preferred format

---

## 🛠️ Technology Stack

| Component | Technology |
|-----------|-----------|
| **SAR Data** | Sentinel-1 (ESA) |
| **Pre-processing** | ESA SNAP |
| **AI Detection** | Roboflow, TensorFlow.js, ONNX |
| **Mapping** | Leaflet.js |
| **Processing** | Client-side image analysis |
| **Export** | GeoTIFF, GeoJSON, PNG, CSV |

---

## 📡 Use Cases

- **🌍 Environmental Monitoring**  
  Track deforestation, flooding, coastal erosion, and land use changes

- **🏗️ Infrastructure Analysis**  
  Monitor construction, roads, urban development, and infrastructure growth

- **🚨 Disaster Response**  
  Rapid damage assessment for floods, earthquakes, and natural disasters

- **🔬 Research & Academia**  
  SAR analysis for scientific studies without complex infrastructure

- **📚 Education**  
  Learn remote sensing and SAR processing hands-on

---

## 🎨 Why NOCTIS-ORBIT?

| Advantage | Benefit |
|-----------|---------|
| **No Infrastructure Costs** | Runs entirely in-browser |
| **Privacy-First** | Your satellite data stays local |
| **Instant Results** | No waiting for server processing |
| **Full Resolution** | No quality degradation |
| **Professional Output** | Publication-ready exports |
| **Open Access** | No API limits or subscription fees |

---

## 📖 Documentation

### Supported Data Formats
- **Input**: GeoTIFF (Sentinel-1, pre-processed)
- **Output**: GeoTIFF, GeoJSON, PNG, CSV

### Detection Pipeline
1. **Image Upload** → Client-side file handling
2. **Classical Processing** → Otsu thresholding + morphological operations
3. **AI Detection** → Roboflow object recognition
4. **Vectorization** → Polygon extraction and metrics
5. **Visualization** → Interactive map rendering
6. **Export** → Multi-format output generation

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- **ESA** for Sentinel-1 satellite data
- **Roboflow** for AI detection capabilities
- **Leaflet** for mapping functionality
- **TensorFlow.js** for in-browser ML inference

---

## 📧 Contact

**NOCTIS ORBIT** — *Bringing satellite intelligence to your browser* 🌍✨

For questions, issues, or suggestions, please open an issue on GitHub.

---

⭐ **Star this repository** if you find it useful!
