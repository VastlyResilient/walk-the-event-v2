// Apple-native HDR (HLG / BT.2020) -> SDR BT.709 conversion using AVFoundation's own
// tone mapping, i.e. the same rendering QuickTime / Photos show.
//
//   swift apple_tonemap.swift frames <video> <w> <h>        -> raw BGRA frames on stdout
//   swift apple_tonemap.swift stills <video> <outdir> t1 t2  -> PNG reference stills
import AVFoundation
import CoreImage
import Foundation
import ImageIO
import UniformTypeIdentifiers

let args = CommandLine.arguments
guard args.count >= 3 else { fatalError("usage: frames|stills <video> ...") }
let mode = args[1]
let asset = AVURLAsset(url: URL(fileURLWithPath: args[2]))

func sdrVideoProps() -> [String: Any] {
    [AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2,
     AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_709_2,
     AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2]
}

if mode == "frames" {
    let w = Int(args[3])!, h = Int(args[4])!
    let sem = DispatchSemaphore(value: 0)
    Task {
        let track = try await asset.loadTracks(withMediaType: .video).first!
        let reader = try AVAssetReader(asset: asset)
        let out = AVAssetReaderTrackOutput(track: track, outputSettings: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: w,
            kCVPixelBufferHeightKey as String: h,
            AVVideoColorPropertiesKey: sdrVideoProps(),
        ])
        out.alwaysCopiesSampleData = false
        reader.add(out)
        reader.startReading()
        let stdout = FileHandle.standardOutput
        var n = 0
        while let sb = out.copyNextSampleBuffer() {
            guard let pb = CMSampleBufferGetImageBuffer(sb) else { continue }
            CVPixelBufferLockBaseAddress(pb, .readOnly)
            let base = CVPixelBufferGetBaseAddress(pb)!
            let bpr = CVPixelBufferGetBytesPerRow(pb)
            let pw = CVPixelBufferGetWidth(pb), ph = CVPixelBufferGetHeight(pb)
            var data = Data(capacity: pw * ph * 4)
            for y in 0..<ph { data.append(base.advanced(by: y * bpr).assumingMemoryBound(to: UInt8.self), count: pw * 4) }
            CVPixelBufferUnlockBaseAddress(pb, .readOnly)
            stdout.write(data)
            n += 1
        }
        FileHandle.standardError.write("frames: \(n) status: \(reader.status.rawValue)\n".data(using: .utf8)!)
        sem.signal()
    }
    sem.wait()
} else if mode == "stills" {
    let outdir = args[3]
    let gen = AVAssetImageGenerator(asset: asset)
    gen.appliesPreferredTrackTransform = true
    gen.requestedTimeToleranceBefore = .zero
    gen.requestedTimeToleranceAfter = .zero
    gen.dynamicRangePolicy = .forceSDR
    for t in args[4...] {
        let time = CMTime(seconds: Double(t)!, preferredTimescale: 600)
        let img = try! gen.copyCGImage(at: time, actualTime: nil)
        let url = URL(fileURLWithPath: "\(outdir)/ref_\(t).png")
        let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
        // Convert into sRGB so the PNG pixels are display-referred SDR.
        let srgb = CGColorSpace(name: CGColorSpace.sRGB)!
        let ctx = CGContext(data: nil, width: img.width, height: img.height, bitsPerComponent: 8, bytesPerRow: 0,
                            space: srgb, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
        ctx.draw(img, in: CGRect(x: 0, y: 0, width: img.width, height: img.height))
        CGImageDestinationAddImage(dest, ctx.makeImage()!, nil)
        CGImageDestinationFinalize(dest)
        print(url.path)
    }
}
