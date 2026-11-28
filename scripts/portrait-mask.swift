import CoreImage
import CoreImage.CIFilterBuiltins
import Foundation
import ImageIO
import Vision

guard CommandLine.arguments.count == 3 else {
    FileHandle.standardError.write(Data("Usage: swift scripts/portrait-mask.swift INPUT_IMAGE OUTPUT_PNG\n".utf8))
    exit(64)
}
let source = URL(fileURLWithPath: CommandLine.arguments[1])
let output = URL(fileURLWithPath: CommandLine.arguments[2])
let request = VNGenerateForegroundInstanceMaskRequest()
let handler = VNImageRequestHandler(url: source)
try handler.perform([request])
guard let masks = request.results?.first, !masks.allInstances.isEmpty, let image = CIImage(contentsOf: source) else {
    throw NSError(domain: "SubjectMask", code: 1, userInfo: [NSLocalizedDescriptionKey: "No foreground subject found"])
}
let mask = try masks.generateScaledMaskForImage(forInstances: masks.allInstances, from: handler)
let alpha = CIFilter.blendWithMask()
alpha.inputImage = image
alpha.backgroundImage = CIImage(color: .clear).cropped(to: image.extent)
// Pull the trim edge in slightly to remove the source background halo.
let scaledMask = CIImage(cvPixelBuffer: mask)
let inset = min(5, max(1, min(image.extent.width, image.extent.height) * 0.006))
alpha.maskImage = scaledMask.applyingFilter("CIMorphologyMinimum", parameters: [kCIInputRadiusKey: inset])
    .applyingFilter("CIGaussianBlur", parameters: [kCIInputRadiusKey: 0.65]).cropped(to: image.extent)
guard let cutout = alpha.outputImage?.cropped(to: image.extent) else { throw NSError(domain: "SubjectMask", code: 2) }
let color = CGColorSpace(name: CGColorSpace.sRGB)!
try CIContext().writePNGRepresentation(of: cutout, to: output, format: .RGBA8, colorSpace: color)
print("Foreground instance count: \(masks.allInstances.count)")
