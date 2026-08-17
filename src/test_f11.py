import ctypes
import time

# VK_F11 is 0x7A
VK_F11 = 0x7A
KEYEVENTF_KEYUP = 0x0002

def press_f11():
    print("Pressing F11 in 2 seconds...")
    time.sleep(2)
    ctypes.windll.user32.keybd_event(VK_F11, 0, 0, 0) # Key down
    time.sleep(0.05)
    ctypes.windll.user32.keybd_event(VK_F11, 0, KEYEVENTF_KEYUP, 0) # Key up
    print("F11 pressed!")

if __name__ == "__main__":
    press_f11()
