import os, tempfile, time, unittest
from pathlib import Path
from unittest.mock import patch
import processor

class LifecycleTests(unittest.TestCase):
    def test_server_stops_at_deadline_without_browser_polling(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(processor,'ROOT',Path(folder)), patch.dict(os.environ,{'CF_APP_ID':'test','CF_APP_SECRET':'test-placeholder-not-a-real-key'}):
            lab=processor.Lab();lab.start(5)
            deadline=time.monotonic()+8
            while not lab.ended and time.monotonic()<deadline:time.sleep(.1)
            self.assertTrue(lab.ended)
            self.assertFalse(lab.status()['preview'])
            with self.assertRaises(ValueError):lab.publish_browser(1,{},'0')

if __name__=='__main__':unittest.main()
