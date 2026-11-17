import XCTest

final class AliaProbeUITests: XCTestCase {
    func testLaunchAndTap() {
        let app = XCUIApplication()
        app.launch()
        app.buttons["tapButton"].tap()
        XCTAssertEqual(app.staticTexts["tapCount"].label, "taps: 1")
    }
}
