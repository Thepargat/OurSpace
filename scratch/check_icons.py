import os
import re

def check_icons():
    icon_names = ["ChevronRight", "RefreshCw", "RefreshCcw"]
    for root, dirs, files in os.walk("src"):
        for file in files:
            if file.endswith((".tsx", ".ts")):
                path = os.path.join(root, file)
                with open(path, "r", encoding="utf-8") as f:
                    content = f.read()
                    for icon in icon_names:
                        # Check if icon is used in JSX or as a value
                        usage_pattern = rf"\b{icon}\b"
                        import_pattern = rf"import\s+{{[^}}]*\b{icon}\b[^}}]*}}\s+from\s+['\"]lucide-react['\"]"
                        
                        if re.search(usage_pattern, content) and not re.search(import_pattern, content):
                            print(f"File: {path} uses {icon} but doesn't seem to import it correctly from lucide-react.")

if __name__ == "__main__":
    check_icons()
