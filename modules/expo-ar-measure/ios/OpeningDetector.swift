import CoreML
import Vision
import CoreVideo
import ImageIO

// One detection in Vision's normalized coordinates: origin bottom-left, relative to the
// *oriented* image (i.e. after the CGImagePropertyOrientation passed to the handler).
struct DetectedBox {
  let label: String
  let confidence: Float
  let rect: CGRect
}

// Thin wrapper around a bundled CoreML object detector (any Vision-compatible detector
// exported with NMS, e.g. `yolo export format=coreml nms=True`). The model is looked up
// by name at runtime so the module compiles and ships without it; auto-detection simply
// stays off until an `OpeningDetector.mlmodel`/`.mlpackage` is added to the Xcode target
// (Xcode compiles it to `OpeningDetector.mlmodelc`).
final class OpeningDetector {
  static let modelName = "OpeningDetector"
  static let minimumConfidence: Float = 0.4

  static var isModelBundled: Bool {
    Bundle.main.url(forResource: modelName, withExtension: "mlmodelc") != nil
  }

  private let request: VNCoreMLRequest

  init?() {
    guard let url = Bundle.main.url(forResource: OpeningDetector.modelName, withExtension: "mlmodelc") else {
      return nil
    }
    let config = MLModelConfiguration()
    config.computeUnits = .all
    guard let model = try? MLModel(contentsOf: url, configuration: config),
          let vnModel = try? VNCoreMLModel(for: model) else {
      return nil
    }
    let req = VNCoreMLRequest(model: vnModel)
    // scaleFill keeps the bounding boxes in the full-image coordinate space so they map
    // back onto the camera preview without an extra crop offset.
    req.imageCropAndScaleOption = .scaleFill
    request = req
  }

  func detect(pixelBuffer: CVPixelBuffer, orientation: CGImagePropertyOrientation) -> [DetectedBox] {
    let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: orientation, options: [:])
    do {
      try handler.perform([request])
    } catch {
      return []
    }
    guard let observations = request.results as? [VNRecognizedObjectObservation] else {
      return []
    }
    return observations.compactMap { obs in
      guard let top = obs.labels.first, top.confidence >= OpeningDetector.minimumConfidence else {
        return nil
      }
      return DetectedBox(
        label: OpeningDetector.normalizeLabel(top.identifier),
        confidence: top.confidence,
        rect: obs.boundingBox
      )
    }
  }

  // Public door/window datasets use varied class names ("Door", "doors", "window_frame"…);
  // collapse them to the two values JS understands and pass anything else through as unknown.
  static func normalizeLabel(_ raw: String) -> String {
    let lower = raw.lowercased()
    if lower.contains("door") { return "door" }
    if lower.contains("window") { return "window" }
    return "unknown"
  }
}
