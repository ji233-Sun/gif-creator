import { HemisphereLight, DirectionalLight, NeutralToneMapping, PMREMGenerator, type Scene, type WebGLRenderer } from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/** Shared between the live and controlled QA cameras; release the generated IBL with the stage. */
export function installModelLighting(renderer: WebGLRenderer, scene: Scene) {
  renderer.toneMapping = NeutralToneMapping;
  scene.add(new HemisphereLight(0xffffff, 0x74788c, 0.65));
  const key = new DirectionalLight(0xfff4ee, 1.45);
  key.position.set(3, 6, 4);
  scene.add(key);
  const fill = new DirectionalLight(0xe9efff, 0.65);
  fill.position.set(-4, 2, 3);
  scene.add(fill);

  const room = new RoomEnvironment();
  const generator = new PMREMGenerator(renderer);
  const environment = generator.fromScene(room, 0.055);
  room.dispose();
  generator.dispose();
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.65;
  return () => {
    scene.environment = null;
    environment.dispose();
  };
}
