plugins {
    `java-library`
    id("com.gradleup.shadow") version "9.5.1"
}

group = "com.zenith.webui"
version = "1.5.0"

// ZenithProxy 由 maven.2b2t.vc 提供（仓库已在 settings.gradle.kts 配置）。
// 格式为 <proxy 版本>+<MC 版本>，例如 3.7.3+1.21.4；也可用 1.21.4-SNAPSHOT 跟随快照。
val zenithProxyVersion = "3.7.3+1.21.4"

java {
    toolchain { languageVersion = JavaLanguageVersion.of(21) }
}

dependencies {
    // 主程序在运行时提供，只参与编译，不能打进插件 JAR
    compileOnly("com.zenith:ZenithProxy:$zenithProxyVersion")
    implementation("io.netty:netty-all:4.1.108.Final")
}

// Sources contain Chinese log strings — never rely on the platform default charset.
tasks.withType<JavaCompile>().configureEach {
    options.encoding = "UTF-8"
}

tasks.shadowJar {
    archiveClassifier.set("")
    archiveBaseName.set("ZenithProxy-WebUI")
    archiveVersion.set(project.version.toString())
    manifest {
        attributes(
            "Implementation-Title" to "ZenithProxy WebUI Plugin",
            "Implementation-Version" to project.version,
            "Implementation-Vendor" to "wxh1024",
            "License" to "AGPL-3.0-or-later"
        )
    }
}

// `./gradlew build` should yield the distributable fat JAR, not just the thin one.
tasks.named("build") {
    dependsOn(tasks.named("shadowJar"))
}
