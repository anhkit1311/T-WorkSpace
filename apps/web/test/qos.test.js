import {test} from 'node:test';
import assert from 'node:assert/strict';
import {QosCollector} from '../src/features/meetings/webrtc/qos.ts';
test('QoS uses selected pair, interval RTP counters, separate directions and resets',()=>{
 const collector=new QosCollector();
 const sample=(timestamp,bytes,packets,lost)=>[{direction:'send',samples:[{id:'transport',type:'transport',timestamp,selectedCandidatePairId:'selected'},{id:'ignored',type:'candidate-pair',state:'succeeded',timestamp,currentRoundTripTime:8},{id:'selected',type:'candidate-pair',state:'succeeded',timestamp,currentRoundTripTime:.02},{id:'out',type:'outbound-rtp',timestamp,bytesSent:bytes}]},{direction:'receive',samples:[{id:'in',type:'inbound-rtp',timestamp,bytesReceived:bytes*2,packetsReceived:packets,packetsLost:lost,jitter:.003}]}];
 assert.equal(collector.collect(sample(1000,100,100,10)).bitrate,null);
 const result=collector.collect(sample(2000,1100,200,12));assert.equal(result.rtt,20);assert.equal(result.jitter,3);assert.equal(result.sendBitrate,8);assert.equal(result.receiveBitrate,16);assert.equal(result.bitrate,24);assert.equal(result.packetLoss,200/102);assert.deepEqual(result.selectedCandidatePairs,['send:selected']);
 assert.equal(collector.collect(sample(3000,10,5,0)).bitrate,null);assert.equal(collector.collect(sample(4000,1010,105,0)).packetLoss,0);
 collector.reset();assert.equal(collector.collect(sample(5000,2010,205,0)).packetLoss,null);
});
test('QoS reports the selected path and audio concealment per interval',()=>{
 const collector=new QosCollector();
 const sample=(timestamp,total,concealed)=>[{direction:'receive',samples:[{id:'transport',type:'transport',timestamp,selectedCandidatePairId:'pair'},{id:'pair',type:'candidate-pair',state:'succeeded',timestamp,localCandidateId:'local'},{id:'local',type:'local-candidate',timestamp,candidateType:'relay',protocol:'udp',relayProtocol:'tls'},{id:'mic',type:'inbound-rtp',kind:'audio',timestamp,totalSamplesReceived:total,concealedSamples:concealed}]}];
 const first=collector.collect(sample(1000,48000,4800));assert.equal(first.transportPath,'relay/tls');assert.equal(first.audioConcealed,null);
 assert.equal(collector.collect(sample(2000,96000,7200)).audioConcealed,5);
});
