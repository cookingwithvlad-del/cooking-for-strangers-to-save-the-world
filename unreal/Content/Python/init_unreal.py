"""Runs when the editor opens this project (Unreal auto-imports Content/Python/init_unreal.py).

Adds Tools > Cooking for Strangers > Build Four Cities and prints how to drive the
build from outside the editor. The heavy lifting is in cfs_build.py.
"""
import unreal

unreal.log("[CFS] Cooking for Strangers project loaded. Build the city with: import cfs_build; cfs_build.run()")
unreal.log("[CFS] From a terminal (editor running, remote execution on): python3 tools/unreal_bridge.py build")

try:
    menus = unreal.ToolMenus.get()
    tools_menu = menus.find_menu("LevelEditor.MainMenu.Tools")
    if tools_menu:
        sub = tools_menu.add_sub_menu("LevelEditor.MainMenu.Tools", "CFS", "CookingForStrangers", "Cooking for Strangers", "Rebuild the game's world in this level")
        for name, label, cmd in [
            ("CFS_Build", "Build Four Cities (import + level)", "import importlib, cfs_build; importlib.reload(cfs_build); cfs_build.run()"),
            ("CFS_Import", "Import models and textures only", "import importlib, cfs_build; importlib.reload(cfs_build); cfs_build.import_assets(); cfs_build.build_materials()"),
            ("CFS_Level", "Rebuild level from world.json", "import importlib, cfs_build; importlib.reload(cfs_build); cfs_build.build_level()"),
        ]:
            entry = unreal.ToolMenuEntry(name=name, type=unreal.MultiBlockType.MENU_ENTRY)
            entry.set_label(label)
            entry.set_string_command(unreal.ToolMenuStringCommandType.PYTHON, "", cmd)
            sub.add_menu_entry("CFS", entry)
        menus.refresh_all_widgets()
except Exception as exc:  # the menu is a convenience; never block editor startup
    unreal.log_warning(f"[CFS] could not add the Tools menu entry: {exc}")
