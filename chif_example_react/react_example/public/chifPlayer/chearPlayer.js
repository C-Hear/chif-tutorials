(function(w) {
  // adds chifPlayer() fn onto global scope
  // w.chifPlayer = streamFiles;

  // adds chifPlayer.streamFiles() fn onto global scope
  w.chifPlayer = { streamFiles };

  // Setting API URL for uuidPos checks in the CHearFile class
  // This is the blacklist of CHear files flagged for blocking
  const EXCEPTION_API =
    'https://us-central1-serene-art-244704.cloudfunctions.net/chear-exception';

  // 01. Scans the DOM and created a NodeList of any 'chear' elements
  //       chear element eg: <chear src="bdee3dc1-32b1-424c-b5cf-cfe18624bb8f_chear.chif"></chear>
  // 02. For each chear element the chearState[first attribute]'s value is passed through the function streamDataFile(target, src)
  //       the function streamDataFile() is passed the chearFile as the target, and chearFile's first attribute's value as the src
  function streamFiles() {
    // chearState object is declared & initialized/assigned an empty object
    let chearState = {};

    document.querySelectorAll('chear').forEach(chearFile => {
      let x = chearFile.getAttribute('src');
      chearState[x] = streamDatFile(
        chearFile,
        x,
      );
    });
  }

  class ByteReader {
    constructor(value, position = 0) {
      // Value is a Uint8Array (an array of 8-bit unsigned integers)
      this.value = value;
      // ? position seems to be 0 every time. Unsure of meaning of position.
      this.position = position;

      // ? Seems to be a
      this.viewer = new DataView(value.buffer);
    }

    // Updates Position
    move(position) {
      this.position = position;
    }

    // ?
    readString(length) {
      // String.fromCharCode() method returns a string created from the specified sequence of UTF-16 code units
      const response = String.fromCharCode.apply(
        null,

        this.value.slice(this.position, this.position + length),
      );
      this.position += length;
      return response;
    }

    readInt16() {
      const value = this.viewer.getUint16(this.position);
      this.position += 2;
      return value;
    }

    readInt32() {
      const value = this.viewer.getUint32(this.position);
      this.position += 4;
      return value;
    }

    readInt64() {
      const left = this.viewer.getUint32(this.position);
      const right = this.viewer.getUint32(this.position + 4);

      const value = 2 ** 32 * left + right;

      if (!Number.isSafeInteger(value))
        throw new Error('file size exceeded safe integer size');

      this.position += 8;

      return value;
    }
  }

  class CHearFile {
    async init(header) {
      // Initialize empty object to store each part of the chif file
      this.parts = {};

      let reader = new ByteReader(header);
      console.log("reader",reader);
      // Read the first 2 characters which contain CHIF confirmation (followed by image type and audio type)
      let format = reader.readString(2);

      if (format !== 'CH') throw new Error('not a valid C-Hear file');

      let version = reader.readInt16();
      if (version !== 2) throw new Error('not a v2 C-Hear file');

      let metaFormat = null;
      let metadata = null;
      let textFormat = null;

      let imageFormat = reader.readString(8).trim();
      let audioFormat = reader.readString(8).trim();

      // todo: we'd likely never have files larger than 4GB (unsigned int32),
      //       which would allow all file size sections to be reduced to 4 bytes
      let imageSize = reader.readInt64();
      let audioSize = reader.readInt64();
      let blockSize = reader.readInt32();
      let metaSize = reader.readInt32();
      let textSize = reader.readInt32();

      if (metaSize > 0) {
        metaFormat = reader.readString(8).trim();
        metadata = reader.readString(metaSize);
      }

      // todo: check metadata for uuid for render bypass
      // uuid:12312-12310-01212-123123123:

      let uuidPos = metadata ? metadata.indexOf('uuid:') : -1;

      if (uuidPos > -1) {
        let [uuid] = metadata.slice(uuidPos + 5).split(':', 1);

        let request = new Request(`${EXCEPTION_API}?id=${uuid}`);

        let response;

        try {
          // check uuid against CHear exception API
          response = await fetch(request);
        } catch (err) {
          console.log(err.message);
        }

        if (response && response.status === 200) {
          let body = await response.text();
          throw new Error(`Can't render CHIF.  Response ${body}`);
        }
      }

      if (textSize > 0) {
        textFormat = reader.readString(8).trim();

        const textPartName = 'text1';

        this.addPart(textPartName, textFormat, textSize);
        this.addSlice(textPartName, reader.position, textSize);
      }

      // todo: consider moving position state into addSlice
      let position = reader.position + textSize;

      const audioPartName = 'audio1';
      const imagePartName = 'image1';

      this.addPart(imagePartName, imageFormat, imageSize);
      this.addPart(audioPartName, audioFormat, audioSize);

      let { blockCount, imageBlockSize, audioBlockSize } = this.getBlockCount(
        imageSize,
        audioSize,
        blockSize,
      );

      let currentBlock = 0;

      while (currentBlock < blockCount) {
        this.addSlice(imagePartName, position, imageBlockSize);
        position += imageBlockSize;
        this.addSlice(audioPartName, position, audioBlockSize);
        position += audioBlockSize;
        currentBlock++;
      }

      let imagePart = this.getPart(imagePartName);

      if (imagePart.sliceSum < imageSize) {
        let imageTailLength = imageSize - imagePart.sliceSum;
        this.addSlice(imagePartName, position, imageTailLength);
        position += imageTailLength;
      }

      let audioPart = this.getPart(audioPartName);

      if (audioPart.sliceSum < audioSize) {
        let audioTailLength = audioSize - audioPart.sliceSum;
        this.addSlice(audioPartName, position, audioTailLength);
      }

      // This is a readout of all the parts of the object
      // console.log('C-Hear file detected and parsed');
      // Object.values(this.parts).forEach(part => {
      //     // console.log(`part ${part.name} size: ${part.size} format: ${part.format}`);
      //     part.slices.forEach(slice => console.log(`${slice.from} - ${slice.to} (${slice.to - slice.from + 1})`));
      // });
    }

    getBlockCount(imageSize, audioSize, blockSize) {
      let blockCount = 1;
      let imageBlockSize = 1;
      let audioBlockSize = 1;

      if (imageSize <= audioSize) {
        imageBlockSize = blockSize;
        blockCount = Math.floor(imageSize / imageBlockSize);
        audioBlockSize = Math.floor(audioSize / blockCount);
      } else {
        audioBlockSize = blockSize;
        blockCount = Math.floor(audioSize / audioBlockSize);
        imageBlockSize = Math.floor(imageSize / blockCount);
      }

      return { blockCount, imageBlockSize, audioBlockSize };
    }

    writeChunk(start, chunk) {
      let end = start + chunk.length - 1;

      Object.values(this.parts).forEach(part => {
        part.slices
          .filter(slice => start <= slice.to && end >= slice.from)
          .sort((a, b) => a.from - b.from)
          .forEach(slice => {
            let sliceBegin = Math.max(slice.from - start, 0);
            let sliceEnd = slice.to < end ? slice.to - start + 1 : chunk.length;
            let sliceSize = sliceEnd - sliceBegin;

            let nextOffset = part.offset + sliceSize;

            let progress = Math.round((nextOffset / part.size) * 10000) / 100;

            // console.log(`chunk ${start}-${end}: ${part.name}: writing ${sliceSize} bytes using slice(${sliceBegin},${sliceEnd}) into ${part.offset}-${nextOffset - 1} / ${progress}%`);

            part.data.set(chunk.slice(sliceBegin, sliceEnd), part.offset);

            part.offset = nextOffset;
          });
      });
    }

    addPart(name, format, size) {
      this.parts[name] = {
        name,
        format,
        size,
        offset: 0,
        data: new Uint8Array(size),
        slices: [],

        sliceSum: 0,
      };
    }

    addSlice(name, from, length) {
      let part = this.parts[name];

      if (!part)
        throw new Error(
          `part '${name}' not found.  Use addPart(name, size) to created it first`,
        );

      part.slices.push({
        from: parseFloat(from),

        to: parseFloat(from) + length - 1,
      });

      part.sliceSum += length;
    }

    getPart(name) {
      return this.parts[name];
    }
  }

  async function streamDatFile(target, src) {
    let chearFile;
    let offset = 0;

    console.log("src", src);
    console.log("src", typeof(src));
    const request = new Request(src);
    let { body } = await fetch(request);
    console.log("body", body);

    const reader = body.getReader();

    // change_me
    // // wrapper div around chear tag --------------------
    // let parent = target.parentNode;
    let wrapper = document.createElement('div');
    // // set the wrapper as child (instead of the element)
    // parent.replaceChild(wrapper, target);
    // // set element as child of wrapper
    target.appendChild(wrapper);

    // // -------------------------------------------------

    while (true) {
      const { done, value } = await reader.read();
      console.log("value", value);

      if (done) {
        break;
      }

      if (offset === 0) {
        // assume the header will fit inside the first chunk for now

        try {
          chearFile = new CHearFile();
          await chearFile.init(value);
        } catch (err) {
          let blockedEl = document.createElement('div');
          blockedEl.innerText = err.message;
          blockedEl.style =
            'height: 80px; width: 235px; border: 2px solid black; padding: 20px; margin-bottom: 20px;';

          // change_me
          // target.parentNode.insertBefore(blockedEl, target);
          wrapper.insertBefore(blockedEl, null);
          return;
        }
      }

      chearFile.writeChunk(offset, value);

      offset = offset + value.length;
    }
    // target.setAttribute('class', 'chif');

    let imgResponse = new Response(chearFile.getPart('image1').data);
    let imgBlob = await imgResponse.blob();

    let imgEl = document.createElement('img');

    imgEl.src = URL.createObjectURL(imgBlob);

    // change_me
    // target.parentNode.insertBefore(imgEl, target);
    wrapper.insertBefore(imgEl, null);

    //   let audioResponse = new Response(chearFile.getPart('audio1').data);
    //   let audioBlob = await audioResponse.blob();
    //   let audioUrl = URL.createObjectURL(audioBlob);

    //   let music = new Audio();
    //   music.type = 'audio/mp3';
    //   music.preload = 'auto';
    //   music.src = audioUrl;

    let audioResponse = new Response(chearFile.getPart('audio1').data);
    let audioBlob = await audioResponse.blob();

    // convert blob data to an audio blob (mp3) by Charles
    let mp3AudioBlob = new Blob([audioBlob], { type: 'audio/mp3' });
    let audioUrl = URL.createObjectURL(mp3AudioBlob);

    let music = new Audio();
    music.type = 'audio/mp3';
    music.preload = 'auto';
    music.src = audioUrl;

    music.volume = 0.00000001;

    // music.play()

    // by Charles
    music.play().catch(err => {
      console.log(err);
      // Do something if browser is not supported or playback fails.
    });

    setTimeout(function() {
      music.pause();
      music.volume = 1;
      music.currentTime = 0;
    }, 500);

    let playerEl = document.createElement('div');
    playerEl.setAttribute('class', 'audioplayer');

    playerEl.innerHTML = `
    <button class="pButton play" alt="play button"></button>
    <button class="rrButton rr" alt="rewind button">
    <svg viewBox="0 0 512 512">
    <path d="M11.5 280.6l192 160c20.6 17.2 52.5 2.8 52.5-24.6V96c0-27.4-31.9-41.8-52.5-24.6l-192 160c-15.3 12.8-15.3 36.4 0 49.2zm256 0l192 160c20.6 17.2 52.5 2.8 52.5-24.6V96c0-27.4-31.9-41.8-52.5-24.6l-192 160c-15.3 12.8-15.3 36.4 0 49.2z">
    </path>
    </svg>
    </button>
    <button class="ffButton ff" alt="fast forward button">
    <svg viewBox="0 0 512 512">
    <path d="M500.5 231.4l-192-160C287.9 54.3 256 68.6 256 96v320c0 27.4 31.9 41.8 52.5 24.6l192-160c15.3-12.8 15.3-36.4 0-49.2zm-256 0l-192-160C31.9 54.3 0 68.6 0 96v320c0 27.4 31.9 41.8 52.5 24.6l192-160c15.3-12.8 15.3-36.4 0-49.2z">
    </path>
    </svg>
    </button>
    <div class="timedisplay">
    <span class="current-time"></span>
    /
            <span class="duration-time"></span>  
        </div>
        `;
    {
      /* <div class="timeline">
            <div class="playhead"></div>
        </div> */
    }
    // SVG Text
    let openText = `<svg viewBox="0 0 512 512"><path d="M256 32C114.6 32 0 125.1 0 240c0 49.6 21.4 95 57 130.7C44.5 421.1 2.7 466 2.2 466.5c-2.2 2.3-2.8 5.7-1.5 8.7S4.8 480 8 480c66.3 0 116-31.8 140.6-51.4 32.7 12.3 69 19.4 107.4 19.4 141.4 0 256-93.1 256-208S397.4 32 256 32z"></path></svg>`;
    // SVG closeText
    let closeText = `<svg viewBox="0 0 640 512"><path d="M64 240c0 49.6 21.4 95 57 130.7-12.6 50.3-54.3 95.2-54.8 95.8-2.2 2.3-2.8 5.7-1.5 8.7 1.3 2.9 4.1 4.8 7.3 4.8 66.3 0 116-31.8 140.6-51.4 32.7 12.3 69 19.4 107.4 19.4 27.4 0 53.7-3.6 78.4-10L72.9 186.4c-5.6 17.1-8.9 35-8.9 53.6zm569.8 218.1l-114.4-88.4C554.6 334.1 576 289.2 576 240c0-114.9-114.6-208-256-208-65.1 0-124.2 20.1-169.4 52.7L45.5 3.4C38.5-2 28.5-.8 23 6.2L3.4 31.4c-5.4 7-4.2 17 2.8 22.4l588.4 454.7c7 5.4 17 4.2 22.5-2.8l19.6-25.3c5.4-6.8 4.1-16.9-2.9-22.3z"></path></svg>`;

    // change_me
    // target.parentNode.setAttribute('class', 'chif-container');
    wrapper.setAttribute('class', 'chif-container');

    let textValue;

    try {
      let textResponse = new Response(chearFile.getPart('text1').data);
      textValue = await textResponse.text();
    } catch {
      textValue = '';
    }

    let textEl = document.createElement('div');
    textEl.setAttribute('class', 'transcription');
    textEl.classList.add('hidden');
    textEl.innerHTML = textValue.replace(/\n/g, '<br />');

    // Create container for timeline with timeline.
    let timeTray = document.createElement('div');
    timeTray.setAttribute('class', 'time-tray');
    timeTray.innerHTML = `
    <div class="timeline">
        <div class="playhead"></div>
    </div>
    `;

    // Create container for audioplayer with toggle buttons for audio & transcription.
    let audioPlayerTray = document.createElement('div');
    audioPlayerTray.setAttribute('class', 'player-tray');

    // Make transcript icon and add it to the audioPlayerTray
    let transcriptIcon = document.createElement('button');
    transcriptIcon.setAttribute('class', 'transcript-button transcript-icon');
    transcriptIcon.addEventListener('click', toggleTranscript);
    document.body.appendChild(transcriptIcon);

    // Set SVG
    transcriptIcon.innerHTML = openText;

    function toggleTranscript(event) {
      const el = wrapper.querySelector('.transcription');
      console.log('target', target);
      console.log('el', el);
      el.classList.toggle('hidden');
      if (transcriptIcon.innerHTML === openText) {
        transcriptIcon.innerHTML = closeText;
      } else {
        transcriptIcon.innerHTML = openText;
      }
    }

    // change_me
    // Fill audioPlayerTray with soundIcon, audioplayer, & transcriptIcon
    // target.parentNode.appendChild(audioPlayerTray);
    wrapper.appendChild(audioPlayerTray); // what?
    // audioPlayerTray.appendChild(soundIcon);
    audioPlayerTray.appendChild(playerEl);
    audioPlayerTray.appendChild(transcriptIcon);

    // change_me
    // Add audioPlayerTray & transcript to chif-container
    // target.parentNode.insertBefore(timeTray, target);
    // target.parentNode.insertBefore(audioPlayerTray, target);
    // target.parentNode.insertBefore(textEl, target);
    wrapper.insertBefore(timeTray, null);
    wrapper.insertBefore(audioPlayerTray, null);
    wrapper.insertBefore(textEl, null);

    // SVG Play
    let playSVG = `<svg viewBox="0 0 448 512"><path d="M424.4 214.7L72.4 6.6C43.8-10.3 0 6.1 0 47.9V464c0 37.5 40.7 60.1 72.4 41.3l352-208c31.4-18.5 31.5-64.1 0-82.6z"></path></svg>`;
    // SVG Play
    let pauseSVG = `<svg viewBox="0 0 448 512"><path d="M144 479H48c-26.5 0-48-21.5-48-48V79c0-26.5 21.5-48 48-48h96c26.5 0 48 21.5 48 48v352c0 26.5-21.5 48-48 48zm304-48V79c0-26.5-21.5-48-48-48h-96c-26.5 0-48 21.5-48 48v352c0 26.5 21.5 48 48 48h96c26.5 0 48-21.5 48-48z"></path></svg>`;

    // Duration of audio clip, calculated here for embedding purposes
    var duration = music.duration;
    // change_me
    // play button
    // var pButton = target.parentNode
    //   .querySelector('.player-tray')
    //   .querySelector('.audioplayer')
    //   .querySelector('.pButton');
    var pButton = wrapper
      .querySelector('.player-tray')
      .querySelector('.audioplayer')
      .querySelector('.pButton');
    // Append Play SVG Initially
    pButton.innerHTML = playSVG;

    // change_me
    // rewind button
    // var rrButton = target.parentNode
    //   .querySelector('.player-tray')
    //   .querySelector('.audioplayer')
    //   .querySelector('.rrButton');
    var rrButton = wrapper
      .querySelector('.player-tray')
      .querySelector('.audioplayer')
      .querySelector('.rrButton');
    // change_me
    // fastforward button
    // var ffButton = target.parentNode
    //   .querySelector('.player-tray')
    //   .querySelector('.audioplayer')
    //   .querySelector('.ffButton');
    var ffButton = wrapper
      .querySelector('.player-tray')
      .querySelector('.audioplayer')
      .querySelector('.ffButton');
    // change_me
    // time display
    // var timeDisplay = target.parentNode
    //   .querySelector('.player-tray')
    //   .querySelector('.audioplayer')
    //   .querySelector('.timedisplay');
    var timeDisplay = wrapper
      .querySelector('.player-tray')
      .querySelector('.audioplayer')
      .querySelector('.timedisplay');
    // change_me
    // time display - current time
    // var currentTime = target.parentNode
    //   .querySelector('.player-tray')
    //   .querySelector('.audioplayer')
    //   .querySelector('.timedisplay')
    //   .querySelector('.current-time');
    var currentTime = wrapper
      .querySelector('.player-tray')
      .querySelector('.audioplayer')
      .querySelector('.timedisplay')
      .querySelector('.current-time');
    //   currentTime.innerText = "00:00";
    // change_me
    // time display - duration time
    // var durationTime = target.parentNode
    //   .querySelector('.player-tray')
    //   .querySelector('.audioplayer')
    //   .querySelector('.timedisplay')
    //   .querySelector('.duration-time');
    var durationTime = wrapper
      .querySelector('.player-tray')
      .querySelector('.audioplayer')
      .querySelector('.timedisplay')
      .querySelector('.duration-time');

    // configure time into readable text
    const timeDisplayConfig = (time, initialize) => {
      let remainder;
      let string;
      let split;
      let hours;
      let minutes;
      let seconds;

      remainder = time;
      string = remainder / (60 * 60) + '';
      split = string.split('.');
      hours = Number(split[0]);

      remainder = Number(`0.${split[1]}`);
      string = remainder * 60 + '';
      split = string.split('.');
      minutes = Number(split[0]);

      if (minutes <= 9) {
        minutes = '0' + minutes;
      }

      if (minutes === 0) {
        minutes = '00';
      }

      remainder = Number(`0.${split[1]}`);
      seconds = Math.floor(remainder * 60);

      if (seconds <= 9) {
        seconds = '0' + seconds;
      }

      if (seconds === 0) {
        seconds = '00';
      }

      if (initialize === true) {
        // if (hours === 0) {
        return `00:00`;
        // }
        // return `00:00:00`;
      }

      // if (hours === 0) {
      return `${minutes}:${seconds}`;
      // }
      // if (hours <= 9) {
      //   hours = '0' + hours;
      // }
      // return `${hours}:${minutes}:${seconds}`;
    };

    // change_me
    // playhead
    // var playhead = target.parentNode
    //   .querySelector('.time-tray')
    //   .querySelector('.timeline')
    //   .querySelector('.playhead');
    var playhead = wrapper
      .querySelector('.time-tray')
      .querySelector('.timeline')
      .querySelector('.playhead');
    // change_me
    // timeline
    // var timeline = target.parentNode
    //   .querySelector('.time-tray')
    //   .querySelector('.timeline');
    var timeline = wrapper
      .querySelector('.time-tray')
      .querySelector('.timeline');

    // timeline width adjusted for playhead
    var timelineWidth = timeline.offsetWidth - playhead.offsetWidth;

    // play button event listenter
    pButton.addEventListener('click', play);

    // rewind button event listenter
    rrButton.addEventListener('click', rewind);

    // fastforward button event listenter
    ffButton.addEventListener('click', fastforward);

    // timeupdate event listener
    music.addEventListener('timeupdate', timeUpdate, false);

    // change

    // makes timeline clickable
    timeline.addEventListener(
      'click',
      function(event) {
        moveplayhead(event);
        console.log('click time', duration);
        music.currentTime = duration * clickPercent(event);
      },
      false,
    );

    // returns click as decimal (.77) of the total timelineWidth
    function clickPercent(event) {
      return (event.clientX - getPosition(timeline)) / timelineWidth;
    }

    // makes playhead draggable
    playhead.addEventListener('mousedown', mouseDown, false);
    // change_me
    // target.parentNode.addEventListener('mouseup', mouseUp, false);
    wrapper.addEventListener('mouseup', mouseUp, false);

    // Boolean value so that audio position is updated only when the playhead is released
    var onplayhead = false;

    // mouseDown EventListener
    function mouseDown() {
      onplayhead = true;
      // change_me
      // target.parentNode.addEventListener('mousemove', moveplayhead, true);
      wrapper.addEventListener('mousemove', moveplayhead, true);
      music.removeEventListener('timeupdate', timeUpdate, false);
    }

    // mouseUp EventListener
    // getting input from all mouse clicks
    function mouseUp(event) {
      if (onplayhead == true) {
        moveplayhead(event);
        // change_me
        // target.parentNode.removeEventListener('mousemove', moveplayhead, true);
        wrapper.removeEventListener('mousemove', moveplayhead, true);
        // change current time
        music.currentTime = duration * clickPercent(event);
        music.addEventListener('timeupdate', timeUpdate, false);
      }

      onplayhead = false;
    }

    // mousemove EventListener
    // Moves playhead as user drags
    function moveplayhead(event) {
      var newMargLeft = event.clientX - getPosition(timeline);

      if (newMargLeft >= 0 && newMargLeft <= timelineWidth) {
        playhead.style.marginLeft = newMargLeft + 'px';
      }
      if (newMargLeft < 0) {
        playhead.style.marginLeft = '0px';
      }
      if (newMargLeft > timelineWidth) {
        playhead.style.marginLeft = timelineWidth + 'px';
      }
    }
    // timeUpdate
    // Synchronizes playhead position with current point in audio
    // Synchronizes time display with current point in audio
    function timeUpdate(updateTime) {
      var playPercent = timelineWidth * (music.currentTime / duration);

      // console.log('timelineWidth', timelineWidth);
      playhead.style.marginLeft = playPercent + 'px';
      currentTime.innerText = timeDisplayConfig(music.currentTime);
      if (music.currentTime == duration) {
        pButton.classList.remove('pause');
        pButton.classList.add('play');
        pButton.innerHTML = playSVG;
      }
      if (updateTime) {
        playPercent -= updateTime;
      }

      // console.log('playPercent', playPercent);
    }

    //   //Play and Pause
    //   function play() {
    //     // start music
    //     if (music.paused) {
    //       music.play();
    //       // remove play, add pause
    //       pButton.classList.remove("play");
    //       pButton.classList.add("pause");
    //     } else {
    //       // pause music
    //       music.pause();
    //       // remove pause, add play
    //       pButton.classList.remove("pause");
    //       pButton.classList.add("play");
    //     }
    //   }

    //Play and Pause
    function play() {
      // start music
      if (music.paused) {
        // music.play();

        // by Charles
        music.play().catch(err => {
          console.log(err);
          // Do something if browser is not supported or playback fails.
        });

        // remove play, add pause
        pButton.classList.remove('play');
        pButton.classList.add('pause');
        pButton.innerHTML = pauseSVG;
      } else {
        // pause music
        music.pause();
        // remove pause, add play

        pButton.classList.remove('pause');
        pButton.classList.add('play');
        pButton.innerHTML = playSVG;
      }
    }

    // rewind
    function rewind() {
      music.currentTime -= 3;
    }

    // fastforward
    function fastforward() {
      console.log('fastforward()');
      music.currentTime += 3;
    }

    // (!!!Commented Out For Now - Retain for Reference!!!)
    // remove rr & ff buttons if timelineWidth is less than 100
    //   if (timelineWidth < 200) {
    //       // remove rewind button
    //       let takeAwayRR = document.querySelector('.rrButton');
    //       takeAwayRR.parentNode.removeChild(takeAwayRR);

    //       // remove fastforward button
    //       let takeAwayFF = document.querySelector('.ffButton');
    //       takeAwayFF.parentNode.removeChild(takeAwayFF);
    //       timelineWidth += 60;
    //   }

    // Gets audio file duration
    music.addEventListener(
      'canplaythrough',
      function() {
        console.log(`inside canplaythrough, ${music.duration}`);
        duration = music.duration;

        // Set Duration Time
        durationTime.innerText = timeDisplayConfig(duration);
        // On load set initial value of currentTime to zero in correct format
        if (music.currentTime === 0) {
          currentTime.innerText = timeDisplayConfig(duration, true);
        }

        // timeline width adjusted for time display
        timelineWidth = timeline.offsetWidth - playhead.offsetWidth;
      },
      false,
    );

    // target width change
    //   target.addEventListener("")

    // getPosition
    // Returns elements left position relative to top-left of viewport
    function getPosition(el) {
      return el.getBoundingClientRect().left;
    }

    console.log('chearFile', chearFile);

    return { file: chearFile };
  }
})(window);
