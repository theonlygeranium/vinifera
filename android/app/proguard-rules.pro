# Capacitor and each native plugin ship consumer rules. These app rules retain
# only metadata and JavaScript bridge entry points that R8 cannot infer across
# WebView boundaries.
-keepattributes RuntimeVisibleAnnotations,RuntimeInvisibleAnnotations,AnnotationDefault
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Preserve line numbers for symbolicated release crash reports without
# exposing source filenames.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
