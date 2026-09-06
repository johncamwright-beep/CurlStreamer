import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from evidence import Evidence
import processor

class EvidenceTests(unittest.TestCase):
    def test_samples_are_bounded_allowlisted_and_record_packet_gaps_not_decoded_motion(self):
        rows=[]; now=[100.0]
        evidence=Evidence(rows.append,lambda: now[0],lambda: now[0]+1000)
        status={"generation":1,"encodedFrames":60,"encoderFps":59.9,"preview":True,
                "token":"PRIVATE-SENTINEL","cameras":{"1":{"connected":True,"packets":100,"payloadBytes":2000,"markedFrames":60,"lastReceivedMs":1100000,"sdp":"PRIVATE-SENTINEL"}}}
        evidence.sample(status)
        for _ in range(100): evidence.sample(status)
        self.assertEqual(sum(x["event"]=="sample" for x in rows),1)
        now[0]+=4;status["cameras"]["1"]["connected"]=False;evidence.sample(status)
        now[0]+=6;status["cameras"]["1"]["connected"]=True;status["encodedFrames"]=120;evidence.sample(status)
        transitions=[x["receiving"] for x in rows if x["event"]=="camera_receiving" and x["slot"]==1]
        self.assertEqual(transitions,[True,False,True])
        samples=[x for x in rows if x["event"]=="sample"]
        self.assertEqual(samples[-1]["encodedFrames"],120)
        self.assertEqual(samples[-1]["camera1Packets"],100)
        evidence.emit("failure",reason="PRIVATE-SENTINEL",pageAccess="PRIVATE-SENTINEL",connectionId="PRIVATE-SENTINEL",token="PRIVATE-SENTINEL")
        self.assertNotIn("PRIVATE-SENTINEL",json.dumps(rows))
        self.assertNotIn("decodedFrames",json.dumps(rows))
        for _ in range(1000):evidence.emit("control_resumed")
        evidence.emit("run_ended",reason="deadline")
        evidence.emit("run_ended",reason="manual_stop")
        self.assertLessEqual(len(rows),513)
        self.assertEqual(rows[-1]["reason"],"deadline")
        self.assertEqual(sum(x["event"]=="run_ended" for x in rows),1)
    def test_cleanup_acknowledgement_is_not_durable_confirmation_and_reason_is_retained(self):
        rows=[]
        with tempfile.TemporaryDirectory() as folder, patch.object(processor,'ROOT',Path(folder)), patch.dict(os.environ,{'CF_APP_ID':'test','CF_APP_SECRET':'fixture-secret-not-a-real-key'}), patch.object(processor.threading.Thread,'start'):
            lab=processor.Lab();lab.evidence=Evidence(rows.append)
            receiver=Mock();receiver.metric={};receiver.proc.poll.return_value=None
            lab.cameras[1]={'receiver':receiver,'source':'PRIVATE-SENTINEL','source_mid':'PRIVATE-SENTINEL','session':'PRIVATE-SENTINEL','mid':'PRIVATE-SENTINEL'}
            lab.cf=Mock();lab.cf.close_track.side_effect=[{},RuntimeError('PRIVATE-SENTINEL')]
            lab.stop('absolute_expiry');lab.stop('manual_stop')
            outcomes=[x for x in rows if x['event']=='cleanup' and x.get('target')=='provider_track' and x['result']=='unknown']
            self.assertEqual([x['providerAcknowledged'] for x in outcomes],[True,False])
            self.assertTrue(any(x.get('target')=='receiver' and x.get('result')=='confirmed' for x in rows))
            self.assertEqual(rows[-1]['reason'],'absolute_expiry')
            self.assertNotIn('PRIVATE-SENTINEL',json.dumps(rows))
            self.assertTrue(lab.ended)
            with self.assertRaises(ValueError):lab.start()
    def test_absolute_expiry_caps_new_run_deadline(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(processor,'ROOT',Path(folder)), patch.dict(os.environ,{'CF_APP_ID':'test','CF_APP_SECRET':'fixture-secret-not-a-real-key'}), patch.object(processor.threading.Thread,'start'), patch.object(processor.time,'time',return_value=1000), patch.object(processor.time,'monotonic',return_value=20):
            lab=processor.Lab();lab.absolute_expires=1040;lab.start(600)
            self.assertEqual(lab.deadline,60)
