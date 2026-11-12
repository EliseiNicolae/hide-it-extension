// Draws the extension icons (icons/icon{16,32,48,128}.png) from plain shapes: a white eye with
// a slash through it on a red rounded square. Original artwork — no symbol font or icon set.
// Run: swift scripts/make-icons.swift icons
import AppKit

let outDir = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "icons"

func render(_ size: Int) -> Data {
    let s = CGFloat(size)
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8,
                               samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                               bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    let ctx = NSGraphicsContext.current!.cgContext

    // Background: rounded square, warm red gradient.
    let inset = size <= 16 ? 0 : s * 0.06
    let plate = CGRect(x: inset, y: inset, width: s - 2 * inset, height: s - 2 * inset)
    ctx.saveGState()
    ctx.addPath(CGPath(roundedRect: plate, cornerWidth: plate.width * 0.24, cornerHeight: plate.width * 0.24, transform: nil))
    ctx.clip()
    let colors = [CGColor(srgbRed: 1.0, green: 0.42, blue: 0.36, alpha: 1),
                  CGColor(srgbRed: 0.90, green: 0.16, blue: 0.20, alpha: 1)] as CFArray
    let gradient = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB), colors: colors, locations: [0, 1])!
    ctx.drawLinearGradient(gradient, start: CGPoint(x: 0, y: s), end: CGPoint(x: 0, y: 0), options: [])
    ctx.restoreGState()

    // Small sizes get bolder strokes so the shape survives at 16 px.
    let small = size <= 32
    let stroke = s * (small ? 0.105 : 0.075)
    let cx = s / 2
    let cy = s / 2
    let eyeW = s * (small ? 0.82 : 0.68)
    let eyeH = s * (small ? 0.56 : 0.46)
    let white = CGColor(gray: 1, alpha: 1)

    // The eye (outline + pupil) goes into its own layer, so the gap along the slash can be
    // cut out of the eye alone without punching through the background.
    ctx.beginTransparencyLayer(auxiliaryInfo: nil)
    let eye = CGMutablePath()
    let left = CGPoint(x: cx - eyeW / 2, y: cy)
    let right = CGPoint(x: cx + eyeW / 2, y: cy)
    eye.move(to: left)
    eye.addQuadCurve(to: right, control: CGPoint(x: cx, y: cy + eyeH))
    eye.addQuadCurve(to: left, control: CGPoint(x: cx, y: cy - eyeH))
    eye.closeSubpath()
    ctx.setStrokeColor(white)
    ctx.setLineWidth(stroke)
    ctx.setLineJoin(.round)
    ctx.addPath(eye)
    ctx.strokePath()
    let pupil = s * (small ? 0.15 : 0.14)
    ctx.setFillColor(white)
    ctx.fillEllipse(in: CGRect(x: cx - pupil, y: cy - pupil, width: pupil * 2, height: pupil * 2))

    // The slash runs top-left → bottom-right; clear a band around it in the eye layer.
    let a = CGPoint(x: s * 0.24, y: s * 0.76)
    let b = CGPoint(x: s * 0.76, y: s * 0.24)
    ctx.setBlendMode(.clear)
    ctx.setLineWidth(stroke * 2.0)
    ctx.setLineCap(.round)
    ctx.move(to: a)
    ctx.addLine(to: b)
    ctx.strokePath()
    ctx.endTransparencyLayer()

    ctx.setBlendMode(.normal)
    ctx.setStrokeColor(white)
    ctx.setLineWidth(stroke)
    ctx.setLineCap(.round)
    ctx.move(to: a)
    ctx.addLine(to: b)
    ctx.strokePath()

    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])!
}

for size in [16, 32, 48, 128] {
    try! render(size).write(to: URL(fileURLWithPath: "\(outDir)/icon\(size).png"))
}
print("icons written to \(outDir)")
