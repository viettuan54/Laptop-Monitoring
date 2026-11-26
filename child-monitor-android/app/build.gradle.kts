import java.net.URI

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}
// Isolated QA uses loopback fixtures and must not register with the real Firebase project.
if (file("google-services.json").exists() && providers.gradleProperty("isolatedQa").orNull != "true") {
    apply(plugin = "com.google.gms.google-services")
}
val apiBaseUrl = providers.gradleProperty("API_BASE_URL").getOrElse("https://api.tuansosad.id.vn/").trim()
val apiUri = URI(apiBaseUrl)
val qaInstance = providers.gradleProperty("qaInstance").orNull
require(qaInstance == null || qaInstance.matches(Regex("[a-z][a-z0-9]*"))) { "Invalid QA instance name" }
require(apiUri.scheme == "https" && !apiUri.host.isNullOrBlank() && apiUri.rawUserInfo == null &&
    apiUri.rawQuery == null && apiUri.rawFragment == null && apiUri.path in listOf("", "/")) {
    "API_BASE_URL must be an HTTPS origin without credentials, path, query or fragment."
}
android {
    namespace = "vn.laptopchildren.parent"
    compileSdk = 35
    defaultConfig {
        // Isolate device QA from a parent's installed app, login and stored settings.
        applicationId = if (providers.gradleProperty("isolatedQa").orNull == "true")
            "vn.laptopchildren.parent.qa" + (qaInstance?.let { ".$it" } ?: "") else "vn.laptopchildren.parent"
        minSdk = 26
        targetSdk = 35
        versionCode = 9
        versionName = "0.7.1"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "API_BASE_URL", "\"${apiBaseUrl.trimEnd('/')}/\"")
    }
    buildTypes {
        getByName("release") {
            isDebuggable = false
            isMinifyEnabled = false
            // Signing is supplied by the release owner; never reuse the debug key.
        }
    }
    buildFeatures { compose = true; buildConfig = true }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
    testOptions { unitTests.isReturnDefaultValues = true }
}
dependencies {
    implementation(platform("androidx.compose:compose-bom:2025.04.01"))
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.9.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    implementation("com.squareup.retrofit2:converter-gson:2.11.0")
    implementation(platform("com.google.firebase:firebase-bom:33.12.0"))
    implementation("com.google.firebase:firebase-messaging")
    testImplementation("junit:junit:4.13.2")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
    androidTestImplementation(platform("androidx.compose:compose-bom:2025.04.01"))
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
