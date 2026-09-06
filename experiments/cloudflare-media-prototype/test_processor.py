import os, tempfile, time, unittest
from pathlib import Path
from unittest.mock import patch
import processor

class LifecycleTests(unittest.TestCase):
    def test_server_stops_at_deadline_without_browser_polling(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(processor,'ROOT',Path(folder)), patch.dict(os.environ,{'CF_APP_ID':'test','CF_APP_SECRET':'test-placeholder-not-a-real-key'}):
            lab=processor.Lab();rows=[];lab.evidence.sink=rows.append;lab.start(5)
            deadline=time.monotonic()+8
            while not any(row['event']=='run_ended' for row in rows) and time.monotonic()<deadline:time.sleep(.1)
            self.assertTrue(lab.ended)
            self.assertEqual(rows[-1]['event'],'run_ended')
            self.assertEqual(rows[-1]['reason'],'deadline')
            self.assertFalse(lab.status()['preview'])
            with self.assertRaises(ValueError):lab.publish_browser(1,{},'0')

if __name__=='__main__':unittest.main()
