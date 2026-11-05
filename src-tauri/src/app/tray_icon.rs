pub(super) fn image() -> tauri::image::Image<'static> {
    tauri::include_image!("../src/assets/brand/sidekick-tray@2x.png")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tray_glyph_has_transparent_background_and_monochrome_detail() {
        let icon = image();
        let pixels: Vec<_> = icon.rgba().chunks_exact(4).collect();
        assert!(
            pixels.iter().any(|p| p[3] == 0),
            "tray background is an opaque square"
        );
        assert!(pixels.iter().any(|p| p[3] == 255), "tray glyph is empty");
        assert!(
            pixels
                .iter()
                .filter(|p| p[3] > 0)
                .all(|p| p[0..3] == [0, 0, 0]),
            "template glyph contains colored pixels"
        );
        assert_eq!(icon.width(), 36);
        assert_eq!(icon.height(), 36);
        assert!(
            pixels.iter().filter(|p| p[3] > 0).count() < pixels.len() * 3 / 4,
            "tray silhouette lost its transparent detail"
        );
    }
}
